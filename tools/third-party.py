"""Build a reproducible dependency inventory and bundle upstream license files.

Run after npm ci and cargo fetch. No project source is copied.
"""
import argparse
import json
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--output", default="licenses")
args = parser.parse_args()
output = ROOT / args.output
output.mkdir(parents=True, exist_ok=True)
metadata = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--locked", "--format-version", "1"], cwd=ROOT, text=True, encoding="utf-8"))
lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
inventory = []
license_files = {}


def collect(folder, package):
    found = []
    for path in sorted(folder.iterdir()):
        if path.is_file() and path.name.lower().startswith(("license", "licence", "copying", "notice", "copyright")):
            name = f"{package}/{path.name}"
            license_files[name] = path.read_bytes()
            found.append(name)
    if not found:
        for path in sorted(folder.glob("*[Rr][Ee][Aa][Dd][Mm][Ee]*")):
            if path.is_file():
                content = path.read_text(encoding="utf-8", errors="replace")
                section = re.search(r"(?im)^#{1,3}\s+licen[sc]e[^\n]*\n", content)
                if section:
                    name = f"{package}/README-license.txt"
                    license_files[name] = content[section.start():].encode("utf-8")
                    found.append(name)
                    break
    extra = ROOT / "licenses" / "upstream" / package
    if extra.is_dir():
        for path in sorted(extra.iterdir()):
            if path.is_file():
                name = f"{package}/{path.name}"
                license_files[name] = path.read_bytes()
                found.append(name)
    return found


for p in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
    if p["source"] is None:
        continue
    folder = Path(p["manifest_path"]).parent
    name = f"cargo/{p['name']}-{p['version']}"
    inventory.append({"ecosystem": "cargo", "name": p["name"], "version": p["version"],
                      "license": p["license"], "source": f"https://crates.io/crates/{p['name']}/{p['version']}",
                      "upstream": p["repository"], "license_files": collect(folder, name)})

for location, p in sorted(lock["packages"].items()):
    if not location or "node_modules/" not in location:
        continue
    name = location.rsplit("node_modules/", 1)[1]
    folder = ROOT / location
    info = json.loads((folder / "package.json").read_text(encoding="utf-8")) if folder.is_dir() else p
    license_value = info.get("license", p.get("license", "UNKNOWN"))
    inventory.append({"ecosystem": "npm", "name": name, "version": p["version"],
                      "license": license_value, "source": f"https://www.npmjs.com/package/{name}/v/{p['version']}",
                      "installed": folder.is_dir(),
                      "license_files": collect(folder, f"npm/{name}-{p['version']}") if folder.is_dir() else []})

# Include any licensing notices bundled with the MAVLink message definitions.
for p in metadata["packages"]:
    if p["name"] in ("mavlink", "mavlink-bindgen"):
        folder = Path(p["manifest_path"]).parent
        for path in folder.rglob("*COPYING*"):
            if path.is_file():
                license_files[f"cargo/{p['name']}-{p['version']}/{path.relative_to(folder).as_posix()}"] = path.read_bytes()

data = {"scope": "Cargo.lock and package-lock.json, including build/test and optional platform packages", "packages": inventory}
(output / "dependency-inventory.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = ["# 依赖版本与许可证", "", "由 `python tools/third-party.py` 从锁文件和已下载依赖生成。包含构建、测试及可选平台依赖，并非每项都链接到每个平台产物。", "", "| 生态 | 包 | 版本 | 许可证 | 原始来源 |", "|---|---|---|---|---|"]
for p in inventory:
    license_label = str(p["license"]).replace("|", "\\|")
    lines.append(f"| {p['ecosystem']} | {p['name']} | {p['version']} | {license_label} | [源码]({p['source']}) |")
(output / "dependency-licenses.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
with zipfile.ZipFile(output / "third-party-licenses.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for name, content in sorted(license_files.items()):
        entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, content)
    archive.write(output / "dependency-inventory.json", "dependency-inventory.json")
    archive.write(output / "dependency-licenses.md", "dependency-licenses.md")
print(json.dumps({"packages": len(inventory), "license_files": len(license_files),
                  "unknown_licenses": [p["name"] for p in inventory if not p["license"] or p["license"] == "UNKNOWN"]}))

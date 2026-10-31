# 第三方许可证与资源

本项目原创 Rust、TypeScript、UI、图标和测试采用 Apache-2.0，完整文本见 LICENSE。项目名称不表示获得 ArduPilot、QGroundControl、MAVLink、Tauri 或地图提供商背书。

## 参考实现

QGC、ROS、ArduPilot 与检测板源码用于核查现有协议和行为。项目没有复制或分发这些参考仓库的源码、Qt/QML 组件、图片、字体或二进制；忽略的 `.reference` 不进入 Git、安装包或发布附件。测试 fixture 由 pymavlink 和 ROS ledger 工具输出报文/JSON后独立整理，生成脚本注明来源；不是现场采集数据。五个参考版本见 docs/source-baseline.md。

## 直接依赖

| 依赖 | 许可证 |
|---|---|
| Rust MAVLink / mavlink-bindgen / mavlink-core | MIT 或 Apache-2.0 |
| Tauri / Wry / Tao | Apache-2.0 或 MIT；各组件以随附文本为准 |
| React / Vite / TypeScript / Lucide | MIT / MIT / Apache-2.0 / ISC |
| MapLibre GL JS | BSD-3-Clause，附带依赖另列 |
| rusqlite / SQLite | MIT / 公有领域 |
| reqwest / Tokio / serde / serde_json | MIT 或 Apache-2.0 |
| zip / uuid / sha2 | 见锁文件中的各版本许可表达式 |
| serialport | MPL-2.0 |

完整版本清单和上游许可证文件由 `tools/third-party.py` 生成，随 Release 提供 `dependency-inventory.json`、`dependency-licenses.md` 和 `third-party-licenses.zip`。清单包括构建、测试和可选平台依赖，范围大于单个安装包。Cargo/npm 锁文件是版本依据。

MPL-2.0 依赖（如 serialport、cssparser、selectors）的原始源码可从清单中对应的 crates.io 版本下载。本项目未修改这些依赖。许可证要求针对其覆盖文件，不改变本项目原创文件的许可。MAVLink 消息 XML 定义按上游自带条款使用，消息布局生成代码不包含 QGC 实现。

保留的 Android 适配使用 Tauri Android 层、AndroidX、Material、Kotlin、Jackson 等原生依赖，本轮不分发 Android 产物。AndroidX、Material、Kotlin/Kotlinx、Jackson、Tauri 使用 Apache-2.0（Tauri另提供MIT）；其他传递依赖按其上游许可。恢复 Android 发布时需随包提供对应 Gradle runtime 依赖报告及许可证。Google SDK、NDK、构建工具和 WebView 属各自提供商，不随源码分发工具链。

## 地图与字体

底图由现有 ROS 地图服务提供。应用不内置 Google、卫星、OSM 等地图影像。用户应遵守实际提供商使用、下载、离线缓存与署名条款，应用保留 MapLibre attribution 区域。已有本机瓦片不授予再分发权。

界面附带 Inter Variable，采用 SIL Open Font License 1.1，版权属于 The Inter Project Authors。字体及许可证来自 rsms/inter 提交 `353b61b9f4430d5f420d56605a6e7993e0941470` 的 `docs/font-files/InterVariable.woff2` 和 `LICENSE.txt`；安装包保留 `licenses/Inter-OFL.txt`。中文使用系统 Microsoft YaHei UI，回退到 Segoe UI。原创应用图标源文件位于 assets/app-icon.svg。

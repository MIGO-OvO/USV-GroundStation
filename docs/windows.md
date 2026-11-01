# Windows 使用与部署

## 安装

下载 Release 的 `USV.GroundStation_0.1.1_x64-setup.exe`，核对同版本 SHA256 后安装。支持 Windows 10/11 x64，需要 Microsoft WebView2 Runtime。NSIS 安装器使用 Tauri 的 WebView2 引导安装；无网络的计算机应先安装微软离线 Runtime。

首版没有 Windows 代码签名证书。系统可能显示未知发布者。项目不会改动飞控、Jetson 或检测板固件。

## 连接

在“连接与设置”选择链路：

| 类型 | 配置示例 | 说明 |
|---|---|---|
| UDP | 本机 `0.0.0.0:14550` | router 向本机发送遥测；匹配目标心跳后锁定对端 |
| TCP | Jetson IP，端口 `5760` | 接入现有 mavlink-router；按现场配置填写 |
| Windows 串口 | `COM5`，`115200` | 使用实际电台/USB 波特率，首版尚未做物理串口验收 |

默认 GCS 为 254/190。留空目标 sysid 时识别 ArduRover/boat component 1；指定 sysid 可限制目标。飞控和载荷 191 分别显示在线状态。串口和 TCP 自动重连只恢复接收，不重放旧物理操作。

同一 UDP 端口通常只能由一个地面站绑定。与 QGC 比对时，在 router 给两个地面站配置各自端点。确认局域网路由及 Windows 防火墙允许所选端口。

## 驾驶舱与任务

连接后先检查船号、飞控模式、上锁状态及定位时间。解锁、AUTO、GUIDED、RTL 受 Rust 准入限制和操作确认约束；HOLD 用于暂停航行。飞控最终决定是否接受操作，诊断可查看 ACK 和发送后的状态证据。

“航线”支持地图点击、拖动、表格经纬度编辑、上移/下移、删除、采样开关及 1 至 255 秒超时。导出 JSON 保留编辑草稿。上传需飞控上锁且退出 AUTO；等待“回读一致”后再执行 AUTO。暂停为 HOLD，继续为 AUTO；“停止任务与采样”分别请求 HOLD 和全载荷 STOP，保留飞控当前任务进度。

顶部“急停”请求推进强制上锁并发送载荷全 STOP。两个结果分别显示；停止未确认时保留保护。恢复需要新的状态证据及现场确认。通信上锁不能代替独立硬件断电或遥控停止装置。

## 采样和数据

Jetson ROS Web 默认地址为 `http://10.42.0.1:5000`。升级时自动替换旧默认 `http://127.0.0.1:5000`，保留用户设置的其他地址。软件读取相对校准泵角、PID、配置、归档和诊断。配置页读回完整 JSON 后再编辑保存，沿用 ROS 原接口校验。

无 GPS 时可在载荷就绪后手动点采样。ROS 负责执行与记录；地面站区分 ACK、关联接单、执行和终态。曲线只记录有效分光帧，有基线才显示吸光度。历史列表来自 ROS，CSV/ZIP 下载保留服务器原字节。QGC 启动任务的归档仍由现有 ROS attempt/window 逻辑管理。

## 离线地图

默认启用 Google 本机直连，无需 ROS 地址。Windows 本机定位可用时自动居中，在后台缓存周边 z8/10/12/14/16/18 的 3×3 瓦片；单轮预缓存约 30 秒内停止发起新下载。地图浏览到的区域也自动保存。再次联网会重试定位和地图加载。

在 Windows“设置 → 隐私和安全性 → 位置”开启位置服务及桌面应用定位权限。无法定位时显示原因，保留上次视野并允许拖动地图。上次保存的本机位置带原接收时间，超过 15 分钟标为“上次本机位置”，与船载 GPS 标记区分。

支持 Google 卫星、街道、卫星与标注、地形。PNG/JPEG 缓存按 Google 样式和 XYZ 分目录保存。已有瓦片立即显示，超过 24 小时在后台检查更新；更新失败保留旧瓦片。网络请求使用系统代理、SOCKS 和系统信任的 TLS 证书。

启用“仅使用本机离线缓存”后不发起地图下载、更新或预缓存。未缓存的区域显示缺失；出航前检查所需区域和缩放级别，并断网复查。“地图来源”可切回 ROS，继续访问旧版缓存和 ROS 地图服务。

应用不导入 QGC 的 Qt 瓦片数据库。Google 请求参数参考 QGC 当前 Google provider，使用未固定影像版本的 lyrs 参数。地图数据不随安装包分发，保留提供商署名。

## 文件位置与诊断

- 数据库、日志、瓦片位于 Windows 应用数据目录下的 `com.migo.usvgroundstation`。可在 `%APPDATA%` 中定位。
- 导出默认在系统下载目录的 `USV-GroundStation` 子目录；同名文件加序号，避免覆盖。
- “诊断”可按 command、request/session 和错误文字筛选，展开单请求时间线。
- 诊断 ZIP 含地面站快照、轮转 JSONL、时钟说明及可用的 Jetson 报告。Jetson 不可达时保留失败原因。

看到“未知”时先查看关联时间线。单个标准 ACK 和普通遥测不能补造任务成功。重连后无法恢复结果时，可由操作员发新的全 STOP，待关联结果及静止状态收敛再操作。不要用再次点击 START 查询旧结果。

## 从源码构建

安装 Node.js 24、Rust stable MSVC、Visual Studio C++ Build Tools（桌面 C++ 与 Windows SDK）和 WebView2。仓库锁定 npm/Cargo 依赖；参考工具链为 Rust 1.98.0。

```powershell
npm ci
cargo test --locked -p usv-core
npm test
npm exec playwright -- install chromium
npm run test:ui
npm run tauri -- build --bundles nsis
./tools/ensure-webview2.ps1
node tools/native-smoke.mjs
```

构建产物在 `target/release/` 和 `target/release/bundle/nsis/`。`ensure-webview2.ps1` 检查 Runtime，缺失时下载并校验微软签名的官方安装器。`native-smoke.mjs` 启动真实 WebView2，读取 IPC、切换页面并截图，不建立设备连接。它是开发检查工具，默认程序不会打开 CDP 端口。

本机检查使用普通权限终端。GitHub Actions 的管理员 runner 由 `ci-native-smoke.ps1` 临时设置本程序的 HKLM WebView2 调试参数并在结束时恢复；WebView2 150 起会忽略管理员进程环境变量中的浏览器参数。该脚本仅用于 Actions。

原生 smoke 使用 `.reference/native-smoke-*` 独立数据目录及 WebView2 profile，避免读写正在运行程序的请求数据库和界面设置。开发环境可用 `USV_GROUNDSTATION_DATA_DIR` 指定隔离的数据目录。设置 `USV_NATIVE_ONLINE_MAP=1` 后，smoke 另检查真实 Google 下载与离线字节一致性；CI 默认不把外部 Google 可达性作为门禁。

# USV GroundStation

当前 ArduPilot ArduRover 无人船的专用地面站。Rust 维护 MAVLink 连接、载荷请求、任务传输和诊断，React 显示实时快照，Tauri 2 提供 Windows 桌面容器。

项目独立位于 `D:\USV-GroundStation`，不依赖 QGC 源码、Qt、子模块或 `usv_ws` 构建目录。

## 功能

- UDP/TCP、Windows 串口，插拔时自动更新串口和设备名称。可自动识别或指定 ArduRover sysid，记忆上次连接并在启动时恢复。
- 飞控 USB 固件刷写，支持本地 APJ/PX4 和与板卡匹配的官方 ArduRover 稳定版。
- 地图驾驶舱、定位/航迹、电池/姿态、解锁/上锁、LOITER/AUTO/GUIDED/RTL。
- 31010 至 31019 载荷控制，持久化 session/request，关联 USVE1、三次同身份发送、分片重组、断线观察恢复。
- 航点编辑、采样开关和超时、JSON 导入导出，原生 MAVLink 任务上传、下载和逐项回读。
- ROS 相对校准角、PID 状态、有效帧曲线、历史记录与 CSV/ZIP 下载。
- ROS 采样/PID/零点/预设/航点与硬件配置、详细诊断、四轴泵和注射泵支持选择数传 MAVLink 或 HTTP。
- 单请求证据时间线、结构化 JSONL、ZIP 诊断包、遥测新鲜度和 Jetson 诊断。
- Google 本机直连、Windows 本机定位、周边预缓存及离线浏览；保留 ROS 地图代理。
- 黑白极简界面、浅色/深色主题和响应式布局。

## 开发

Windows 需要 Node.js 24、Rust stable/MSVC、Visual Studio C++ Build Tools、WebView2。当前验证使用 Rust 1.98.0。

```powershell
npm ci
cargo test -p usv-core
npm test
npm exec playwright -- install chromium
npm run test:ui
npm run tauri -- dev
```

仅运行 `npm run dev` 会打开浏览器界面预览。设备连接及 ROS 访问需在 Tauri 中运行。

```powershell
npm run tauri -- build --bundles nsis
./tools/ensure-webview2.ps1
node tools/native-smoke.mjs
```

安装包输出到 `target/release/bundle/nsis/`。本轮只构建和发布 Windows x64 NSIS；Android 构建已暂停，现有适配记录见 [Android 说明](docs/android.md)。

## 使用

1. 打开“设置”，选择 UDP/TCP/串口及目标 sysid，连接后等待飞控与载荷分别上线。参数保存在本机，下次启动自动连接；手动断开暂停本次运行的重连。
2. 默认启用 Google 底图，联网自动缓存 Windows 本机位置周边及浏览区域。ROS 默认 `http://10.42.0.1:5000`。无热点时，在设置中将配置与控制通信切换为数传 MAVLink；数据与文件仍使用 HTTP，详见 [数传配置与控制](docs/ros-radio.md)。
3. 在“航线”编辑航点及采样参数。飞控上锁并退出 AUTO 后，命名整个任务并上传，等待完整回读一致。AUTO 确认框沿用任务名称。
4. 切入 AUTO 前确认定位。采样航线还需要任务回读、载荷空闲、有效分光帧和基线。暂停航行使用 LOITER，停止任务与采样使用 HOLD 和载荷停止。点采样确认框中输入本次名称。
5. 在“诊断”按 request/session 查看接单、进度与终态证据；在“采样”选择 ROS 任务下载归档。

通信超时显示状态未知。地面站不会在重连时重发旧 START。推进急停与载荷停止分别确认，解除急停还需现场确认。

数据文件使用 `采样名称-时间戳`；航点采样使用 `任务名称-航点序号-时间戳`，序号对应飞控 `waypoint_seq`。时间戳为 UTC+8 的采样开始时间，格式 `YYYYMMDD_HHMMSS_ffffff`。CSV/ZIP 下载保留 ROS 返回的中文文件名；名称准备失败或被取消时不启动采样。此功能需同步更新 ROS trigger、pump 与 Web。

## 验证与发布范围

当前版本为 `v0.1.5` 预发布。飞控识别和刷写的操作步骤与适用范围见 [Windows 使用与部署](docs/windows.md#飞控固件刷写)。实船航行及采样按实机验收清单执行。

Jetson ARM64 router 已在授权空闲台架切换，数传载荷回程恢复，UART framing 错误仍存在。[数传问题记录](docs/map-payload-fix.md)

| 文档 | 内容 |
|---|---|
| [源码基线](docs/source-baseline.md) | 五个参考仓库及核查依据 |
| [架构](docs/architecture.md) | Rust actor、IPC、存储及模块边界 |
| [协议兼容](docs/protocol.md) | 身份、ACK、USVE1、STOP、任务及 Web API |
| [Windows 使用与部署](docs/windows.md) | 连接、缓存、导出、安装和排错 |
| [Android 适配记录](docs/android.md) | 已暂停构建；保留工具链、权限及生命周期说明 |
| [测试报告](docs/verification.md) | 可重复命令与实际验证结果 |
| [QGC 功能对照](docs/qgc-comparison.md) | 首版实现、复用与范围 |
| [实机验收](docs/hardware-acceptance.md) | 台架和现场场景 |
| [发布说明](CHANGELOG.md) | 版本功能和限制 |

## 许可证

本项目原创实现采用 Apache-2.0。协议实现与测试数据独立编写，router 修复补丁保留上游许可。第三方依赖、MAVLink 消息定义及地图提供商权利见 [第三方声明](THIRD_PARTY_NOTICES.md)。地图数据不包含在安装包中。

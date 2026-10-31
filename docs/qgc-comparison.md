# QGC 功能对照

基线为 [source-baseline.md](source-baseline.md) 所列主分支。新项目独立实现控制层与 UI，没有复制 QGC C++/QML 或资源。以下“实现”指代码与离线验证，台架和实船结果另见验收清单。

| 现有功能/入口 | 新项目 | 首版范围与证据 |
|---|---|---|
| Vehicle UDP/TCP/串口 | Rust transport / Station | UDP/TCP 真实回环测试，Windows 串口已编译，待电台验收 |
| 识别飞控、191 载荷心跳 | telemetry | 单机 ArduRover/boat，源和目标过滤，心跳分别过期 |
| GPS、航迹、姿态、电池 | 驾驶舱 / MapView | 真实消息驱动，字段 TTL，未知不填示例值 |
| 模式、解锁/上锁 | Rust flight requests | HOLD/AUTO/GUIDED/RTL，发送后状态确认 |
| 推进急停与载荷停止 | SafetyState | 强制上锁及全 STOP 独立证据，保留现场确认入口 |
| USVPayloadCommandController | payload / station | 10 命令、24 位身份、重试、USVE1、STOP 范围、旧会话隔离 |
| USVPayloadFactGroup | telemetry / Reading | 26 字段、相对校准角、健康和有效帧状态 |
| 原 QGC 采样控制 | 采样工作区 | 点采样、暂停/恢复/停止、走航、归零、分光、基线 |
| 四泵 PID / 实时数据 | ROS `/api/manual/status` + MAVLink | PID 原始状态、相对角、有效帧电压/吸光度曲线 |
| 航点规划 | Planner / MapLibre | 点击、拖动、排序、删除、经纬度及采样超时 |
| Mission 上传与下载 | 原生 Rust mission | 分包、重试、ACK 后回读，home 合成差异处理 |
| 42702 定点采样 | mission items | param1=1、1～255s，实船 `USV_SMPL/USV_DONE` 闭环待验收 |
| AUTO 暂停/继续/停止 | 模式 + 载荷全 STOP | HOLD 暂停、AUTO 继续，停止保留飞控任务进度 |
| QGC .plan 文件 | 独立 version=1 JSON | 只导入本项目草稿格式；不导入 QGC 通用复杂任务 |
| 离线地图 | ROS 瓦片代理 + 本机缓存 | 缓存已浏览区域，离线读取有 HTTP fixture；不读取 Qt 瓦片数据库 |
| ROS 数据中心 | 原 Web API | 任务列表、样本、CSV/原始 CSV/ZIP；真实 Jetson 归档待联调 |
| 通信日志 | Rust JSONL/ZIP、诊断 UI | request/session 时间线、重组/重试/过期、ROS 诊断，时钟域独立 |
| Windows 桌面包 | Tauri / NSIS | 真实 x64 构建和 WebView2 IPC smoke |
| Android 平板 | 保留 Tauri ARM64 适配 | 本轮暂停构建与发布，新界面未在 Android 验证 |
| 刷写、完整参数树 | 原 QGC | 专用地面站首版不提供，继续使用 QGC 维护 |
| PX4、多机型、视频、语音 | 不进入首版 | 按用户范围排除 |

ROS 自动化、泵 PID、分光采集、归零、补偿、油相分隔和数据存储继续由现有 Jetson/ESP32 执行。地面站不重写执行器，也不以普通 ACK 或遥测变化替代关联完成证据。

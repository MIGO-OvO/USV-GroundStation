# ROS 配置与控制数传

## 使用

在“采样 → 采样配置”读取船端流程，编辑步骤和循环次数后保存。此处通过 MAVLink 数传保存，并读取船端配置核对结果。“设置 → 采样数据中心”通过 HTTP 查看和下载归档。

在“设置 → ROS 配置与设备”选择“数传 MAVLink”。连接数传电台并收到飞控心跳后，可读取和修改采样配置、PID 参数、零点、预设、航点采样配置、硬件设置，查看 Jetson 节点、bridge、MAVROS 诊断，操作四轴手动泵和注射泵。四轴运动前先开启手动模式，再读取手动状态；运动回零使用船端现有校准流程。

通信方式默认是 HTTP，选择保存在本机。HTTP 地址继续使用原来的 `http://10.42.0.1:5000`。数据中心、地图数据、CSV/ZIP、历史原始数据和诊断包导出继续走 HTTP。切换通信方式后，失败的动作不会自动换通道重发。

船端启用 `USV_WEB_REQUIRE_AUTH=1` 时，在“控制令牌”填写同一 Web 控制令牌。令牌仅保存在本次界面会话内，数传消息内容不写入地面站诊断日志。MAVLink 本身不提供链路加密。

## 部署与链路

同时更新本仓库与 `usv_ros`，重新构建地面站并重启 Jetson 的 ROS 系统。Jetson 上仍须运行 Web 配置服务；bridge 通过 `127.0.0.1` 调用现有 API，地面站无需连接无人船热点。非默认 Web 端口由 `usv_bringup.launch` 的 `web_port` 传入 bridge 的 `ros_web_port`。

```text
地面站 Rust actor → 数传电台 → 飞控 MAVLink 路由
  → Jetson bridge (component 191) → 本机 Web API → 原有 ROS 控制服务
```

使用现有固件的定向 `V2_EXTENSION` 路由，不需要修改飞控或检测板固件。QGC 的原有载荷命令、遥测和 HTTP 网页入口继续可用。

## 协议

`V2_EXTENSION.message_type=31020`，请求目标为当前船 sysid / component 191，响应目标为请求来源。地面站来源为 254/190。标准 payload 为 249 字节，每片可带 218 字节压缩内容。

帧头采用小端格式 `<4sBQQIHHH>`，共 31 字节：`USR1`、类型、地面站 session、Jetson boot nonce、request、片序号、总片数、有效字节数。类型 0–7 依次为 HELLO、READY、REQUEST、ACK、FETCH、RESPONSE、WAIT、ERROR。JSON 经 zlib 压缩，原文上限 128 KiB，压缩后上限 64 KiB；超限时提示改用 HTTP。

请求只开放上述配置、诊断及设备 API，不接受任意 URL、串口文本命令、文件或采样 START。PID 参数使用 `/api/pid/config`；原网页 PIDTEST 调试接口继续由 HTTP 提供。数传诊断保留完整最新报告，事件和历史各取最新 20 条，自动诊断读取完成后至少间隔 30 秒。

分片按次确认，丢包重发同一 session/request/分片。完整请求只提交一次，丢失结果只拉取缓存。桥接连接退役或进程重启会更换 boot nonce；过期、被驱逐或旧 boot 请求不能再次执行。每帧发送间隔至少 200 ms，停止请求为 50 ms；同一阶段最多 6 次发送，整个请求上限 120 秒。排队最多 8 个地面站请求。

STOP 使用独立船端工作线程并取消待执行请求，沿用泵控服务的停止截止时间。物理请求在发送前记录到本地身份存储；断线、结果丢失或进程中断后保持输出状态未知，读取状态不会重发动作。接口成功表示船端返回了结果，物理完成仍按设备状态和现场检查判断。

## 验证

```powershell
cargo test --locked -p usv-core --test ros_radio
npm test -- src/rosAccess.test.ts src/RosControls.test.tsx
cargo build --locked -p usv-core --example ros_radio_probe
python -B tools/verify-ros-radio.py --ros-root D:/usv_ws/src/usv_ros --probe target/debug/examples/ros_radio_probe.exe
```

最后一项使用真实 Rust Station、MAVLink 2 编码与 Flask API，通过本机模拟连接注入重复分片和 ACK/结果丢包，不打开硬件串口。Jetson 台架还需断开热点，仅用电台逐项读写回读；在泵运行中测试 STOP、掉电、丢包与恢复，并复查原 HTTP 网页和数据下载。

2026-11-05 Windows 本机验证：Rust 67 项、前端 20 项、界面 9 项通过；Clippy、rustfmt、Tauri 检查和前端构建通过。ROS 针对性回归 72 项通过，本机互通完成 39 次 API 调用。扩展硬件回归有一项旧地图测试仍期望高德配置，在 ROS 原始提交 `6d95a8e1` 上同样失败，当前源码返回 Google 配置。

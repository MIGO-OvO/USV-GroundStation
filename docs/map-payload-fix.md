# 地图缓存与载荷离线修复

日期：2026-11-01。版本：0.1.1。

## 地图

旧版默认关闭底图，启用后仍依赖 ROS PNG 代理，且首次视野使用固定坐标。Google 卫星服务实际返回 JPEG，旧缓存入口也无法直接接入该响应。

本次改为默认 Google 本机直连，参考 QGC `src/QtLocationPlugin/Providers/GoogleMapProvider.*` 的 XYZ、lyrs 和服务器分片方式，独立实现 Rust 请求与缓存。Windows Geolocator 提供本机经纬度及精度；船载 GPS 继续只表示船位。位置不可用时保留上次视野，用户仍可浏览地图。旧设置自动迁移，ROS 来源仍可选择。

周边预缓存使用 z8/10/12/14/16/18 各 3×3 瓦片，约 30 秒后停止发起新请求。PNG/JPEG 持久缓存先返回已有数据，超过 24 小时后台检查；支持 ETag/Last-Modified 和 304，失败保留旧文件。离线设置由 Rust 维护，停止新预缓存和更新请求。HTTP 与 WinRT 工作独立于 MAVLink 控制线程。

定位查询只读取位置，地图离线策略统一由 `map_set_offline` 设置。原生 IPC 回归先设置离线，再调用携带旧在线参数的定位查询，最后请求未缓存瓦片，确认定位查询不会重新启用地图网络。修复前，真实 Windows CI 程序在这一场景发起 Google 请求，回归断言失败。

实网检查先复现 `unsupported scheme socks5h`。补齐 reqwest SOCKS、系统代理和系统证书支持后，真实 Google 卫星瓦片下载成功：10341 字节，重新创建缓存实例后离线读取完全一致。测试没有关闭 TLS 校验。

当前电脑 Windows 全局位置权限为 Deny，Geolocator 返回 `0x80070005`。实际定位和周边自动下载需开启 Windows 定位后复查；UI 测试中的本机坐标与瓦片是明确的测试数据。

## 载荷在线判定

旧版只用同 sysid 的 component 191 心跳维持在线。ArduRover 在 `Rover/GCS_MAVLink_Rover.cpp::send_usv_payload` 中，以飞控 1/1 转发已缓存的载荷字段；QGC 收到有效载荷字段后也会刷新 linkActive。原判定与该链路不一致。

回归测试先复现：持续每 500 ms 接收 1/1 的 USV_PROTO，只停 191 心跳，5600 ms 时仍被判离线。修复后用 10 分钟的单调时间输入验证在线与关联任务均保持；随后停止全部载荷证据、继续飞控/MAVROS 心跳，仍按原 5 秒期限转离线，任务转 unknown 并禁止重试 START。

在线证据现在是 191 心跳或同 sysid 的 1/191 有效载荷字段。26 项白名单、有限数、sysid/component 过滤及字段 3 秒新鲜度保持。普通飞控消息、MAVROS 心跳、USV_DONE 和无关数值不维持载荷在线。诊断分别显示心跳/遥测时间，记录 payload_link_lost/restored；ACK、USVE1 和执行终态的关联规则保持。

## 现场断流仍需逐跳定位

本机保留的实际日志时间窗为北京时间 13:05:56.390 至 13:29:08.329，共 61502 条 MAVLink 收发记录。飞控 1/1 与 MAVROS 1/240 持续收包；该时间窗没有 component 191 报文，也没有载荷 NAMED_VALUE_FLOAT 或 frame_rejected 记录。期间切换/重开 COM14 后仍未收到载荷证据。

这些日志表明该时间窗存在实际载荷回程断流，不能只靠在线判定修复消除。现有记录缺少断流起点和 Jetson 侧证据，尚无法区分 bridge 停发、router/TELEM2 路径丢失或飞控未收到有效载荷输入。原始日志与摘要已在本机 `.reference/bugs/2026-11-01` 留存，不随源码或安装包分发。

接下来需对齐同一时间窗的 Jetson `/api/diagnostics/link`、`/api/diagnostics/system`、bridge/router 日志及飞控端计数。检查 bridge 的 tx_heartbeat、tx_named_value、TCP 会话、deferred/error 与飞控缓存输入。观察性核查期间不重放采样 START。真实断流和实船恢复尚未验收。

## 验证入口

```powershell
cargo test --locked -p usv-core
cargo clippy --locked -p usv-core --all-targets -- -D warnings
npm test
npm run test:ui -- --workers=1
cargo run --locked -p usv-core --example map_probe -- .reference/map-smoke
npm run tauri -- build --bundles nsis
```

map_probe 只调用 Windows 定位和 Google 地图，不连接飞控。回环 MAVLink、HTTP fixture 和界面测试结果分别记录在 [verification.md](verification.md)。

# USV GroundStation

<!-- impeccable:product-schema 1 -->

## Platform

web

Tauri 2 Windows 桌面应用。React 在 WebView 内运行。本次只构建和发布 Windows NSIS 安装包。

## Stack

用户指定 Rust、React、TypeScript、Vite、Tauri 2、MapLibre GL JS。

## Users and purpose

无人船操作员连接现有 ArduPilot ArduRover、监控航行、规划航点采样、控制 ROS 载荷、查看采样数据并追踪通信异常。Rust 维护连接和请求生命周期，页面切换保留后台状态。

## Constraints

协议以源码基线为准。载荷执行留在 Jetson ROS 与检测板。标准 ACK 不证明关联任务完成。恢复不重发旧 START。核心导航使用原生 MAVLink Mission Protocol。无硬件连接时只报告离线验证。

## Workspaces

航行驾驶舱、航线规划、采样与数据、通信诊断、连接与设置。浅色与深色两种主题，重点支持 1280×720、1920×1080 Windows 窗口。

## Visual commitment

按用户提供的 Minimalism 参考图重设计：黑白灰、Inter 字体、留白、细分隔线、横向图标与文字导航。实心黑白按钮表示主操作，蓝色表示地图交互和键盘焦点，红色表示停止或故障。功能、真实状态和操作确认完整保留。

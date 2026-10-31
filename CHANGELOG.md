# 发布记录

## v0.1.0 预发布

首个独立 Rust + React + Tauri 专用地面站。面向当前 ArduPilot ArduRover 和 USV ROS 关联载荷协议。

### 功能

- UDP/TCP、Windows 串口，飞控与 component 191 心跳、26项载荷字段及导航遥测。
- 持久化24位身份、同身份重传、USVE1与STATUSTEXT重组、三类STOP、旧请求隔离和重连观察恢复。
- 地图驾驶舱、飞控模式与解锁/上锁、推进急停和载荷停止分别确认。
- 航点与采样参数编辑、JSON导入导出、原生Mission上传/下载/回读。
- ROS配置、相对泵角、PID、分光曲线、历史CSV/ZIP下载、ROS离线瓦片及本机缓存。
- 单请求通信时间线、JSONL/ZIP诊断。
- 参照用户提供的极简风格图重设计界面：白色与炭灰主题、Inter字体、细分隔线、图标文字导航和紧凑操作区。
- 浅色/深色主题切换与持久化，1280×720及1920×1080工作区检查。
- Windows x64 NSIS安装包和Windows CI。本轮不构建或发布Android。

### 验证范围

实际测试与构建结果见 docs/verification.md。协议fixture、UDP/TCP回环、HTTP测试服务及UI测试均为离线环境。Windows真实WebView2启动检查不连接船。未完成Jetson/ESP32台架、实船、干净Windows安装或Android设备端验收。

### 已知限制

- Windows安装包没有代码签名，干净Windows安装仍待验收。
- Android适配代码保留，本轮界面没有Android构建或设备验收结果。
- 不配置MAVLink signing；未验证的签名帧会拒绝。
- 离线地图缓存已浏览区域，不导入QGC Qt瓦片库或提供区域批量下载。
- 本项目任务JSON仅覆盖专用航点/采样模型，不导入QGC通用.plan复杂任务。
- ROS/执行器重启后的exactly once不能由地面站单独保证；未知请求不会自动重启物理任务。

此版本用于兼容性和台架验证。实机验收步骤见 docs/hardware-acceptance.md。

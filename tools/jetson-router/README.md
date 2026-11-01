# 载荷回程路由修复候选

适用版本：MAVLink Router `2362c620f483cef1edd574fb962a373a288e4b9e`（现场 `v4-16-g2362c62`）。上游：[mavlink-router](https://github.com/mavlink-router/mavlink-router/tree/2362c620f483cef1edd574fb962a373a288e4b9e)。补丁沿用 Apache-2.0；原文件版权声明保留。它不编入 Windows 程序，也不会由安装器部署。

## 缺陷与修复

该版本 `Endpoint::read_msg` 无法校验未知消息 ID 的 CRC，却在 `handle_read` 中永久记录其 sysid/compid。UART 收到来源看似 `1/191` 的损坏未知帧后，`accept_msg` 会持续拒绝来自真实载荷的报文。重新连接 TCP 或地面站不会清除 UART 的记录。

`route-learning.patch` 只在 CRC 有效时学习来源。未知消息仍转发，同时明确排除接收端和同组端点，保留回环过滤。只发送未知消息的设备需先用标准心跳登记路由。

离线测试以真实 router 进程、两个临时 PTY 和本机 TCP 重现：原版在“unknown source cannot poison the UART route”失败；补丁版通过 14 项检查，包括已知坏 CRC、未知消息透传、接收端及同组回环、TCP 重连、有效来源学习。测试不打开真实串口，不连接远程设备。

## 在独立源码副本中复现

使用已有的完整 router 源码副本，包含其 `modules/mavlink` 头文件。先核对上述 SHA，在副本中执行；`$GS` 为本地地面站源码目录。

```bash
git rev-parse HEAD
meson setup build-usv -Dsystemdsystemunitdir=/tmp
meson compile -C build-usv -j2 mavlink-routerd
python3 "$GS/tools/jetson-router/test_route_learning.py" build-usv/src/mavlink-routerd
# 原版预期失败；保存输出后应用补丁。
git apply --check "$GS/tools/jetson-router/route-learning.patch"
git apply "$GS/tools/jetson-router/route-learning.patch"
meson compile -C build-usv -j2 mavlink-routerd
python3 "$GS/tools/jetson-router/test_route_learning.py" build-usv/src/mavlink-routerd
```

测试依赖 Python 3 标准库；构建依赖 C++ 编译器、Meson、Ninja。上游 PTY 设置可能打印不支持 serial ioctl，测试使用的字节收发和路由断言仍须全部通过。

## 现场核验与部署状态

2026-11-01：候选已完成 WSL x64 离线验证，未替换 Jetson `/usr/bin/mavlink-routerd`，未重启现场 router，未完成 ARM64 构建或实船验证。

现场同窗观测到 bridge 向 TCP 持续发送有效 `1/191` 载荷帧、UART framing 错误增长、本机数传只有 FCU/MAVROS。尚未抓到触发路由污染的 `1/191` 未知帧，不能据此认定现场断流只有这一原因。参数截图确认 SERIAL2 为 921600、MAVLink2、OPTIONS=0，与 Jetson 一致；UART 错误仍需处理。

部署需要操作员确认船静止且无采样任务，因为重启 router 会中断通信。执行顺序：

1. 保存 router 原命令行、原二进制 SHA256 与可执行备份；在隔离目录构建 ARM64 候选，先运行本测试。
2. 操作员确认台架状态后，仅切换 router 二进制并按原命令启动，保留原端口与 921600 设置。
3. 用相同单调时间窗比较 TCP 有效载荷帧、UART rx/tx/frame 计数及 COM14 收到的载荷字段。仅观察，不重发 START。
4. 持续观察超过原断流时间；验证真实断流仍显示离线。若服务不能启动或通信退化，停止候选，恢复原二进制及原命令行。

当前会话仅进行了只读现场诊断。现场切换及恢复结果需另行记录，Windows 安装器不能替代 Jetson 侧修复。

# 载荷回程路由修复候选

适用版本：MAVLink Router `2362c620f483cef1edd574fb962a373a288e4b9e`（现场 `v4-16-g2362c62`）。上游：[mavlink-router](https://github.com/mavlink-router/mavlink-router/tree/2362c620f483cef1edd574fb962a373a288e4b9e)。补丁沿用 Apache-2.0；原文件版权声明保留。它不编入 Windows 程序，也不会由安装器部署。

## 缺陷与修复

该版本 `Endpoint::read_msg` 无法校验未知消息 ID 的 CRC，却在 `handle_read` 中永久记录其 sysid/compid。UART 收到来源看似 `1/191` 的损坏未知帧后，`accept_msg` 会持续拒绝来自真实载荷的报文。重新连接 TCP 或地面站不会清除 UART 的记录。

`route-learning.patch` 只在 CRC 有效时学习来源。未知消息仍转发，同时明确排除接收端和同组端点，保留回环过滤。只发送未知消息的设备需先用标准心跳登记路由。

离线测试以真实 router 进程、两个临时 PTY 和本机 TCP 重现：原版在“unknown source cannot poison the UART route”失败。当前回归还包含 2026-11-01 在 Jetson 抓到的未知 `1/191` 头部帧；这条现场帧同样使原版阻断后续载荷，候选通过全部 19 项检查，包括已知坏 CRC、未知消息透传、接收端及同组回环、TCP 重连、有效来源学习。测试不打开真实串口，不连接远程设备。

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

2026-11-01：操作员授权空闲台架切换。ARM64 候选已在 Jetson 独立目录编译、通过 19 项隔离检查，并按原参数替代运行进程。数传已持续接收载荷超过 31 分钟；详情见 [现场报告](../../docs/map-payload-fix.md)。此前 v0.1.2 的 WSL 检查为 14 项，未包含后来捕获的现场帧。

UART framing 错误仍在增长。SERIAL2 为 921600、MAVLink2、OPTIONS=0，与 Jetson 一致。补丁消除未知来源污染，串口错误原因及物理任务验收继续按现场证据处理。

当前运行程序：`/home/jetson/.local/share/usv-router-20261101/build/src/mavlink-routerd`。

SHA256：`5b9462d9248113c8f6210d0c3742c1dcb8c51694c4dbe083e85cf65e42fb5cf1`。

原二进制、启动 argv 与 SHA256 位于 `/home/jetson/.local/share/usv-router-20261101/backup/`；原 SHA256 为 `e8a71bf553af0c759e923ca62b4c7fbc6ce4d92cef6b5914f2522ee78b5ee83c`。系统 `/usr/bin/mavlink-routerd` 没有覆盖，现有 PID 文件已更新。当前账号不能免密写系统目录，整机重启仍会选用系统原版。

完成管理员安装后，后续原启动脚本可使用候选；命令不重启当前进程：

```bash
sudo install -m 0755 /home/jetson/.local/share/usv-router-20261101/build/src/mavlink-routerd /usr/bin/mavlink-routerd
```

恢复后续启动使用的系统二进制：

```bash
sudo install -m 0755 /home/jetson/.local/share/usv-router-20261101/backup/mavlink-routerd /usr/bin/mavlink-routerd
```

部署需要操作员确认船静止且无采样任务，因为重启 router 会中断通信。执行顺序：

1. 保存 router 原命令行、原二进制 SHA256 与可执行备份；在隔离目录构建 ARM64 候选，先运行本测试。
2. 操作员确认台架状态后，仅切换 router 二进制并按原命令启动，保留原端口与 921600 设置。
3. 用相同单调时间窗比较 TCP 有效载荷帧、UART rx/tx/frame 计数及 COM14 收到的载荷字段。仅观察，不重发 START。
4. 持续观察超过原断流时间；验证真实断流仍显示离线。若服务不能启动或通信退化，停止候选，恢复原二进制及原命令行。

这次只切换了 router 进程。Windows 安装器独立交付，Jetson 的管理员安装状态以以上记录为准。

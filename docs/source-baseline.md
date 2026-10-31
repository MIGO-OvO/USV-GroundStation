# 源码基线与功能边界

核查日期：2026-11-01。使用 fetch 后的远端默认分支读取源码，原工作区文件保持原状。

| 仓库 | 分支 | 提交 |
|---|---|---|
| MIGO-OvO/WQ-USV-QGroundControl | master | 5aa5e3c38809c685e168687c830af43dda40d271 |
| MIGO-OvO/usv_ros | main | 4c083d331a91553ec1d96343b169638fea9ce908 |
| MIGO-OvO/usv_ws | main | 936805bf184b1121be57355754f173c1ab7b4376 |
| MIGO-OvO/DetFirmware | main | 790c3ceaa6acdb936e0307acceb26c7bc16e8947 |
| ardupilot-usv | master | 2f64492510d433225ce6313e9a51cff35b281d80 |

QGC #20/#21 与 ROS #96/#97/#98 均已合并。ROS 本地另有未合并的重复事件重放修复 351a8558，本项目以远端 main 契约为基线，客户端自行拒绝重复或倒退事件序号。

## 职责

Rust 独占连接、MAVLink、请求身份、重试、任务协议、遥测新鲜度与诊断。React 提交意图和展示 Rust 快照。Tauri 管理应用数据目录及 IPC。ROS 保留泵、PID、准备、采样执行、归档和 Web 数据服务。飞控保留航行、失控保护与任务采样等待。检测板保留串口控制与看门狗。

## 关键源码

- QGC `custom/res/USVPayloadCommandController.qml`：按身份关联事件，STOP 记录发送时的目标任务，终态后新静止状态收敛。
- QGC `custom/res/USVCockpitController.qml`：推进急停与载荷 STOP 分别确认。
- QGC `custom/res/USVOperationsState.qml`：GPS、载荷和字段新鲜度分别判断。
- QGC `custom/src/USVPayloadFactGroup.cc:99`：持久化 24 位 session；`:134`：USVE1 验证。
- QGC `src/Vehicle/Vehicle.cc:2832`：关联请求最多三次、1 秒间隔；接单期限 31018 为 40 秒，STOP 为 15 秒，其余为 5 秒。文档中“不自动重试”的表述与当前源码不同，以源码为准。
- ROS `scripts/lib/payload_protocol.py`：同身份同参数只重放结果，异参拒绝，进程重启不保证 exactly once。
- ROS `scripts/usv_mavlink_router_bridge.py:1003`：请求固定 executor；`:1043`：TCP 恢复后 recover_only 查询原结果。GCS 不通过重发 START 恢复。
- ROS `scripts/mavlink_trigger_node.py`：命令准入、STOP 范围、真实设备回执。
- ROS `scripts/mission_plan_service.py`：42702 参数、home 占位和任务回读。
- ROS `scripts/web_config_server.py:5558`：归档数据；`:6176`：链路诊断；`:4553`：离线瓦片服务。
- 飞控 `Rover/GCS_MAVLink_Rover.cpp:591`、`Rover/USVPayload.h:14`、`Rover/sensors.cpp`：同系统 191 载荷缓存，26 字段转发。
- 飞控 `Rover/mode_auto.cpp:1048`：42702/param1=1、USV_SMPL、匹配 USV_DONE；超时和载荷断链进入 HOLD。

## 首版范围

重写驾驶舱、载荷请求控制、地图规划和诊断 UI；原生实现 UDP/TCP、Windows 串口、MAVLink Mission 上传及回读。复用 ROS 的配置、相对标定角度、PID 细节、历史数据和离线瓦片 API。飞控参数树、刷机、多机型、视频、语音及插件系统不进入首版。

功能实现和验证结果见 `verification.md`，硬件检查见 `hardware-acceptance.md`。

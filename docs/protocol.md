# MAVLink 与 ROS 兼容契约

基线提交和原始源码位置见 [source-baseline.md](source-baseline.md)。协议事实以对应提交源码为准。

## 基础链路

使用 MAVLink 2、GCS `254/190`。只通过 `MAV_AUTOPILOT_ARDUPILOTMEGA`、component 1、Rover/boat 心跳识别飞控；可指定 sysid。飞控心跳超过 5 秒失效，普通字段超过 3 秒失效。

载荷在线需要飞控在线，并在 5 秒内收到同 sysid 的 component 191 心跳，或 component 191/飞控 component 1 的有效载荷字段。ArduRover 将缓存字段以 1/1 重发，因此单独丢失 191 心跳不等于载荷链路离线。26 项字段之外的 NAMED_VALUE_FLOAT、非有限数、其他 sysid/component 及普通 MAVROS 心跳不会刷新载荷在线时间。心跳和字段接收时间分别保留；具体操作仍需新鲜的 USV_PROTO、USV_STAT 等准入证据。

标准消息委托 rust-mavlink。COMMAND_LONG、COMMAND_INT、COMMAND_ACK 使用独立生成的字段布局，将 command 保存为 u16，以支持 31010 至 31019。三个标准 CRC extra 分别为 152、158、143；没有不安全枚举转换。首版不配置 MAVLink signing，签名帧因未验证被拒绝。

## 状态读取与恢复

Jetson bridge 每秒发送一次 component 191 HEARTBEAT，每秒发送两轮载荷遥测。飞控缓存字段 3 秒，以 2 Hz 向活跃地面站链路转发；原始 NAMED_VALUE_FLOAT 不直接路由，转发后的来源为飞控 component 1。空闲时仍持续发送，字段值相同也刷新地面站接收时间。

飞控在线时，载荷离线、USV_STAT/USV_PROTO/USV_ADS 缺失或过期，或存在未知请求，都会触发自动重读，间隔至少 2 秒，同类请求在发送队列中去重。“采样与实时数据”页的“重读状态”按钮使用相同路径，输出未知时也可读取。

重读使用发往选定 sysid/component 191 的 COMMAND_LONG 512（MAV_CMD_REQUEST_MESSAGE）。由 Jetson bridge 处理，飞控只负责路由：

定向读取后，USV_STAT/USV_PROTO/USV_ADS 仍有缺失或过期时，下一次读取改用同 sysid/component 0 的广播，绕过失效的 191 定向路由；间隔仍至少 2 秒。关键字段恢复后再次使用 191。广播只用于只读 512，物理操作继续使用原目标和身份规则。飞控对广播查询产生的普通 ACK 不构成载荷恢复证据。

| 参数 | 含义 |
|---|---|
| param1 | 251，读取新鲜 NAMED_VALUE_FLOAT 快照 |
| param2 / param3 / param4 | 待恢复原请求的 session / request / command；没有未结束请求时均为 0 |
| param5 | 手动“重读状态”为 1，请求恢复断开的 MAVROS；周期读取为 0 |
| param6 / param7 | 0；param7 保持标准 Response Target 默认值 |

Jetson 在本轮常规遥测中回复仍有效的源字段；查询不会延长源字段有效期。指定的历史结果还必须匹配查询方 sys/comp、原 executor 和请求参数，再经 recover_only 查询原 ledger。标准 ACK 512 只说明查询被接收，地面站继续等待新遥测和关联 USVE1。

手动读取的 param5=1 由 bridge 转交 `/usv/link_recovery/request`。MAVROS 已连接时不重启；断开时由独立恢复节点按退避期限重启 MAVROS。该标记只恢复通信，不启动采样、分光或泵控。手动读取若遇到 2 秒限频，标记保留到下一次读取，发送后清除。旧 bridge 忽略该标记，读取行为保持兼容；需要同步更新 ROS 和地面站才能通过数传发起恢复。

已收到过飞控证据的 Jetson bridge，若连续 10 秒收不到飞控心跳及受支持遥测，会退役 TCP 会话，并按现有 2 秒退避重连。原会话的停止保护继续生效，结果恢复保留原请求身份。未接入过飞控的独立 Web/实验室会话不启用此超时。ROS 状态源时间戳过期、晚于当前时钟或早于已接收状态时，bridge 丢弃该条回调。

bridge 还检查发送方向：尝试发送后连续 10 秒没有完成任何帧写入，或每 5 秒发出的 TIMESYNC 探测在 15 秒内没有收到选定飞控回显的当前标识，都会退役并重建 TCP。TIMESYNC 只确认往返，不设置时钟；单调时钟调度避免校时卡住通信循环。roslaunch 在 bridge 退出后以 2 秒间隔重启该节点。重连只恢复通信，原任务仍按关联结果和停止保护处理。

完整重读能力需要同步更新地面站与 Jetson bridge。旧 bridge 会忽略该查询；现有飞控固件无需增加 NAMED_VALUE_FLOAT 的流订阅功能。

## 载荷命令

目标为选定 sysid/component 191。`param1/2` 保留原命令业务参数，`param3=request`、`param4=session`，均为 1 至 16777215 的整数。

| command | 操作 | 成功证据 |
|---|---|---|
| 31010 | 点采样 | 匹配 attempt 的终态，随后新静止状态 |
| 31011 | 停止采样及全输出 | 关联停止回执，随后新静止状态 |
| 31012 / 31013 | 暂停 / 恢复采样 | 关联接单回执；运行状态另行展示 |
| 31014 | 归零校准 | 关联终态，随后新静止状态 |
| 31015 | 启动走航 | 各轮独立 attempt；单轮成功不结束走航请求 |
| 31016 | 停止走航及其采样 | 对应 STOP 回执与发送时捕获的走航请求范围 |
| 31017 | 设置分光基线 | 关联接单回执；新基线遥测另行展示 |
| 31018 | 启动分光 | 关联接单回执；有效测量帧另行展示 |
| 31019 | 停止分光 | 对应 STOP 回执，不释放泵组未知状态 |

关联命令最多发送三次，完整写入后每隔一秒重试，保持同身份和参数。总接单期限：31018 为 40 秒，三个 STOP 为 15 秒，其余为 5 秒。接单、超时、断线或 STOP 作用到原任务后停止重传。ROS 的身份 ledger 负责同身份去重，进程重启后的 exactly once 不能由地面站单独保证。

身份存储失效时仅三个 STOP 可退回无关联兼容发送。标准 ACK 只用于唯一在途的无关联 STOP；正常关联请求绝不通过标准 ACK 结束。

## 请求生命周期

`created → sent → accepted → executing → succeeded/failed/cancelled`。缺少关联接单或连接失效进入 `unknown`。普通 ACK 是独立诊断证据，没有 session/request，不能证明某次采样已接单或完成。

USVE1 验证目标 sysid、发送方 sys/comp、command、session/request、版本、递增 seq、有效 attempt。STATUSTEXT 按源 sys/comp/id 分组，序号从 0 连续递增；一秒内最多 750 字节。乱序、缺失、过期和跨源分片不会拼接为有效事件。

终态与后续静止状态分开记录。没有终态而只观察到运行后静止时，可以解除旧任务占用，结果仍保持原请求的已知证据，不补造成功。旧 STOP 只作用于创建时的目标任务列表；旧 generation 的 STOP 不解除新连接保护。

断线后保留请求身份与未知状态，不重发旧 START。ROS bridge 在自己的新 TCP 会话中用 recover_only 查询原 executor，地面站接收其恢复事件。若结果无法恢复，操作员可发新的全 STOP，取得回执和新静止状态后再开始新的操作。

## 26 项字段

```text
USV_VOLT USV_ABS PUMP_X PUMP_Y PUMP_Z PUMP_A
USV_STAT USV_PKT USV_STEP USV_STOT USV_LOOP USV_LTOT USV_SCNT
USV_PERR USV_PMOD USV_BSET USV_REF USV_BASE USV_VLD
USV_JTMP USV_ETMP USV_JCPU USV_JMEM USV_EHEAP USV_ADS USV_PROTO
```

`USV_PROTO=1` 是关联协议准入条件。PUMP_X/Y/Z/A 已由 ROS 减去 Web 校准零点，地面站直接显示相对角，负值显示未校准。健康字段 -1 显示未知。曲线要求有效帧和基线，按 USV_PKT 去除转发副本；TTL 使用地面站接收时钟。

## 航行与任务

HOLD=4、LOITER=5、AUTO=10、RTL=11、GUIDED=15。模式请求使用 176，解锁和上锁使用 400。推进急停为强制上锁参数 21196，并独立发送 31011。收到新的飞控遥测后确认相应状态。

第 0 项为 ArduPilot Home 占位。采样项为 `42702 param1=1`，新任务总时限默认 1800 秒，支持 1–2048 秒。超过 255 秒时写入 `param3`，同时在 `param2` 保留 255 秒供旧任务格式使用。飞控回读需要匹配两个参数。一次上传最多包含 500 个航点和 1001 个任务项。

上传 ACK 到达且所有任务项已被请求后，下载并比较所有可执行项。飞控 `AP_Mission.cpp:825` 会用当前 home 合成第 0 项，因此该项不比较规划坐标。普通航点采用整数坐标，允许一个 1e-7 度单位误差。任务下载完整并不证明采样闭环完成。

AUTO 执行或继续当前飞控任务。已知含采样项的任务需通过回读，同时收到新鲜的载荷空闲、分光有效和基线状态。LOITER 用于暂停航行并定点驻留，要求新鲜定位。“停止任务与采样”分别下发 HOLD 与载荷全 STOP，保留飞控任务进度。

## ROS Web

Rust HTTP client 复用以下接口：

- `/api/config`、`/api/calibration/offsets`、`/api/manual/status`
- `/api/data/missions`、`/api/data/mission/<id>?view=data-center`、`/<id>/samples`
- `/<id>/archive`、`/<id>/raw.csv`、`/<id>/csv`
- `/api/diagnostics/link`、`system`、`events`、`history`、`export`
- `/api/map/config`、`/api/map/tile/{style}/{z}/{x}/{y}.png?v=3`

JSON 保留 ROS 的 success/data envelope。原始归档直接保存 HTTP 字节。采样归档继续由 ROS 的 attempt/window 逻辑创建，地面站不伪造补录。配置和地图有限写入开放，HTTP 物理控制接口未接入。

点采样先用当前配置通道调用 `POST /api/recording/name`，body 为 `{"name":"湖心"}`。成功后将 `data.token` 放入 `31010.param1`，其余物理命令、session/request 及准入流程不变。token 范围为 `1..2^24-1`，可被 MAVLink float32 精确传递；船端保留最近 64 个名称，未知 token 拒绝启动。名称准备期间取消、STOP 或连接身份变化会取消待发送的启动。

上传航点任务和进入 AUTO 前，通过 `POST /api/recording/mission` 保存整个任务名称。ROS 将名称、采样开始时间和 `waypoint_seq` 固定到本次采样 context。下载优先采用服务端 UTF-8 `Content-Disposition` 文件名，保存前校验路径和 Windows 文件名字符；已有同名文件继续使用独占创建避免覆盖。

## 诊断时间

本机 mono_ms 只在同一 clock_id 内相减。unix_ms 是地面站接收时间。飞控 boot time、Jetson 墙钟和本机单调时钟不直接相减；没有中间链路记录时，时间线保持未确认。ZIP 包含快照、JSONL、可选 Jetson 报告及 clocks.txt。

# MAVLink 与 ROS 兼容契约

基线提交和原始源码位置见 [source-baseline.md](source-baseline.md)。协议事实以对应提交源码为准。

## 基础链路

使用 MAVLink 2、GCS `254/190`。只通过 `MAV_AUTOPILOT_ARDUPILOTMEGA`、component 1、Rover/boat 心跳识别飞控；可指定 sysid。载荷 component 191 心跳独立判断。飞控心跳超过 5 秒失效，普通字段超过 3 秒失效。

标准消息委托 rust-mavlink。COMMAND_LONG、COMMAND_INT、COMMAND_ACK 使用独立生成的字段布局，将 command 保存为 u16，以支持 31010 至 31019。三个标准 CRC extra 分别为 152、158、143；没有不安全枚举转换。首版不配置 MAVLink signing，签名帧因未验证被拒绝。

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

HOLD=4、AUTO=10、RTL=11、GUIDED=15。模式请求 176，解锁/上锁 400；推进急停为强制上锁参数 21196，并独立发送 31011。状态确认使用发送后新遥测，标准 ACK 不替代状态。

原生任务协议支持 MISSION_COUNT、REQUEST_INT/REQUEST、ITEM_INT/ITEM、ACK、REQUEST_LIST。包含 ArduPilot 第 0 项 home 占位，采样项为 42702、param1=1、param2=1 至 255 秒。一次上传不超过 500 个航点、1001 个任务项。任务协议每 1.5 秒重试，最多三次，整个传输上限 300 秒。

上传 ACK 到达且所有任务项已被请求后，下载并比较所有可执行项。飞控 `AP_Mission.cpp:825` 会用当前 home 合成第 0 项，因此该项不比较规划坐标。普通航点采用整数坐标，允许一个 1e-7 度单位误差。任务下载完整并不证明采样闭环完成。

AUTO 执行/继续当前飞控任务，HOLD 暂停航行。“停止任务与采样”分别下发 HOLD 和载荷全 STOP，保留飞控任务进度。飞控当前不接受非零首末序号的 MISSION_START，因此没有发送此种变体。

## ROS Web

Rust HTTP client 复用以下接口：

- `/api/config`、`/api/calibration/offsets`、`/api/manual/status`
- `/api/data/missions`、`/api/data/mission/<id>?view=data-center`、`/<id>/samples`
- `/<id>/archive`、`/<id>/raw.csv`、`/<id>/csv`
- `/api/diagnostics/link`、`system`、`events`、`history`、`export`
- `/api/map/config`、`/api/map/tile/{style}/{z}/{x}/{y}.png?v=3`

JSON 保留 ROS 的 success/data envelope。原始归档直接保存 HTTP 字节。采样归档继续由 ROS 的 attempt/window 逻辑创建，地面站不伪造补录。配置和地图有限写入开放，HTTP 物理控制接口未接入。

## 诊断时间

本机 mono_ms 只在同一 clock_id 内相减。unix_ms 是地面站接收时间。飞控 boot time、Jetson 墙钟和本机单调时钟不直接相减；没有中间链路记录时，时间线保持未确认。ZIP 包含快照、JSONL、可选 Jetson 报告及 clocks.txt。

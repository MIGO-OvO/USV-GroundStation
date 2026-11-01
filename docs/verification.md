# 验证记录

## v0.1.3 连接记忆、启动恢复与现场切换

日期：2026-11-01，Windows x64 NSIS；未构建 Android。

| 检查 | 结果与范围 |
|---|---|
| Rust 核心 | 60 项通过：地图 4、Mission 8、回环网络 3、协议 39、ROS/HTTP 6 |
| Rustfmt / 严格 Clippy | 通过；核心全部 targets |
| React | 14 项通过；包含串口参数恢复、延迟快照回填、编辑时不被后台覆盖、地图就绪早于 load 事件 |
| Playwright | 9 项通过；四种尺寸、浅深主题及地图场景 |
| TypeScript/Vite、NSIS | 本机生产构建通过；最终 CI 和产物对应提交见 Release 的 BUILD_PROVENANCE.json |
| 原生进程重启 | 真实 Tauri/WebView2 + Rust IPC，隔离 profile；通过 UI 保存本机 TCP 配置，页面刷新保持手动断开，重新启动进程自动建立且只建立一条连接 |
| 实际数传自动连接 | 隔离 profile 保存 COM14/115200、sysid 1 后重启原生进程，自动恢复飞控与载荷在线；两次均无物理请求、无解码拒绝，UI 无异常 |
| Jetson ARM64 router | 原版被现场未知帧阻断；候选通过 19 项真实 daemon/PTY/回环 TCP 检查 |
| 现场接收 | 授权空闲切换后 COM14 载荷持续恢复超过 31 分钟、94147 帧，观测到全部 26 字段；UART framing 错误仍在增长；没有下发物理控制命令 |

连接回归覆盖三种参数及目标 sysid 持久化、无效保存项可恢复、不可达端口恢复、手动断开、启动单次连接以及旧 START 不重放。Windows 重试测试发现：失败连接占满 2 秒后，原先按尝试开始时刻计时会立即再试，延迟错误快照。期限现从尝试结束后计算，保留完整 2 秒间隔；修复后原断言通过，未放宽超时。

真实串口接收检查还复现了地图初始化白屏：`isStyleLoaded()` 已为 true，而 track/route 源仍等到更晚的 load 回调才创建。即时快照回归先在 `setData` 失败。将这两个源和图层放入初始样式后，回归通过；样式重建时也使用同一来源生命周期。

实际数传检查只提交一次连接意图，第二次进程启动从 SQLite 自动恢复。核对该 profile 的发送日志，只有 GCS 心跳和 511 遥测频率请求。现场计数、报文、部署权限和剩余验收见 [问题记录](map-payload-fix.md)；这些接收与连接检查尚未覆盖实船控制任务。

## v0.1.2 现场地址与 router 候选

日期：2026-11-01。本机 React 11 项、Playwright 9 项、TypeScript/Vite 与 diff 检查通过。新增检查覆盖新安装默认地址、旧 loopback 默认迁移、自定义 ROS 地址保留。Playwright 首次双 worker 因 esbuild 内存分配失败中断；限制进程 GOMAXPROCS=2、单 worker 后全部通过，未删除断言。

router 候选在 WSL 使用现场 `2362c62` 源码编译。原版先在真实 router 进程、PTY 与本机 TCP 回归中失败：合成未知 `1/191` 帧后，真实载荷未到达 UART。应用三文件补丁并重新编译后，14 项检查通过，包括未知消息透传、接收端/同组回环、CRC 错误、TCP 重连及有效来源学习。独立内存端点测试也复现并通过修复。重跑入口见 [候选说明](../tools/jetson-router/README.md)。这项 WSL 检查不产生 Linux 发布包。

Jetson 现场只读检查证实 TCP 载荷仍在发送、UART framing 错误增长、数传载荷断流，参数截图与 Jetson 显式配置一致。尚未抓到触发来源污染的 `1/191` 未知帧；候选未部署、未重启现场服务，也未执行物理控制命令。完整证据边界见 [问题记录](map-payload-fix.md)。Windows 当前提交的 CI、NSIS 与原生检查以 Release 随附构建来源记录为准。

## v0.1.1 修复验证

日期：2026-11-01，Windows x64。本轮只构建 Windows NSIS。

| 检查 | 结果 | 范围 |
|---|---|---|
| Rust 核心 | 57 通过，0 失败 | 地图 4、协议 37、Mission 8、回环网络 2、ROS/HTTP 6；doc-tests 通过 |
| 严格 Clippy / Rustfmt | 通过 | 核心全部 targets，工作区格式 |
| TypeScript / Vite | 通过 | 生产构建，MapLibre 体积提示仍存在 |
| React | 8 通过，0 失败 | 包含旧 ROS 地图设置迁移 |
| Playwright | 9 通过，0 失败 | 单 worker；四种尺寸、浅深主题、本机定位与船位分离、拒绝定位后继续浏览、离线视野保持 |
| 真实 Google 下载 | 通过 | 10341 字节卫星 JPEG；重建缓存实例后离线字节一致 |
| Windows 本机定位 | 系统拒绝，0x80070005 | 本机全局位置权限 Deny；未宣称真实坐标及周边预缓存验收通过 |

误判复现先失败于 5600 ms，再验证持续 10 分钟的载荷转发遥测维持在线、真实断流仍过期且禁用 START 重试。地图测试覆盖 JPEG/PNG、304、更新失败保留缓存及离线模式停止新下载。实际载荷日志没有收到 191/载荷字段的情况仍需 Jetson 证据定位，见 [问题记录](map-payload-fix.md)。

## v0.1.0 原始交付记录

日期：2026-11-01。Windows x64，Rust 1.98.0、Node.js 24.20.0，项目版本 0.1.0。参考源码提交见 [source-baseline.md](source-baseline.md)。

## 自动化结果

| 检查 | 实际结果 | 范围 |
|---|---|---|
| `cargo test --locked -p usv-core` | 51通过，0失败 | 协议35、Mission 8、真实UDP/TCP回环2、HTTP/地图/诊断6 |
| `cargo clippy --locked -p usv-core --all-targets -- -D warnings` | 通过 | 核心及测试；生成绑定单独隔离；固定日志参数及280字节栈消息有局部说明 |
| `cargo fmt --all -- --check` | 通过 | Rust工作区 |
| `npm run build` | 通过 | TypeScript检查及Vite生产构建 |
| `npm test` | 7通过，0失败 | UI状态、按钮准入、无GPS点采样、操作确认、ACK证据、新鲜度、草稿校验 |
| `npm run test:ui` | 7通过，0失败 | 1280×720、1920×1080、1024×768、600×900；确认框名称/说明/Escape；Windows浅深主题、切换及持久化 |
| Windows Release / NSIS | 极简界面构建通过，安装包约5.70 MiB | 真实MSVC/Tauri构建，随包包含依赖和Inter许可证 |
| `node tools/native-smoke.mjs` | 最终包重跑通过 | 真实Windows WebView2和Rust IPC，不连接设备 |
| Android | 本轮不构建、不发布 | 已暂停CI；旧界面APK记录保留在android.md |

Windows产物、构建来源与校验值随Release提供。安装包未做Windows代码签名。Vite对MapLibre所在JS块提示超过500 kB，构建未失败；此为首版已知体积提示。

## 协议与故障场景

- 63帧MAVLink黄金fixture和3类USVE1事件，与pymavlink 2.4.49及参考ROS RequestLedger输出交叉验证。生成脚本在 tools/generate_protocol_fixture.py。这些是独立测试数据，不是现场抓包。
- MAVLink CRC、截断、流式半帧、自定义u16命令；正确sysid/compid和26字段。
- SQLite事务身份、重启新session、未结束旧任务超出最近2000历史仍加载。
- 相同身份与参数的三次发送，模拟executor按身份去重，ACK不结束关联执行。
- USVE1身份/attempt/seq、旧会话/旧请求/迟到结果，分片连续/乱序/缺失/过期和跨源。
- STOP优先、不同范围、普通命令等待时仍可停止，旧generation STOP不释放新保护。
- 通信超时和应用重启转unknown，TCP重新连接及重启均不重放START。
- 发送后新心跳确认飞控操作，解锁必须有新鲜上锁证据；推进与载荷分别停止确认。
- Mission分包、请求/ACK、完整回读、采样项42702、home合成差异和错误参数。
- ROS success/data、QGC来源记录读取、CSV/ZIP原字节、HTTP错误与接口边界。
- 在线PNG瓦片保存后停掉本机HTTP测试服务，仍可离线读同一瓦片；诊断ZIP保留各clock_id。

## UI检查

Playwright使用实际React/MapLibre渲染和无设备空状态。确认框另有测试夹具，引用同一产品组件。浏览器预览的物理按钮禁用，没有示例遥测冒充设备状态。

本轮按用户提供的Minimalism图片替换原绿色界面，检查29张工作区截图及空筛选框截图。使用fresh独立agent执行impeccable复核契约：字体、白灰/炭灰层级、地图与导航、真实空状态和确认流程符合方向契约；发现一处浅色placeholder对比度不足。将opacity改为1后，浏览器计算样式为#666666，白底对比度5.74:1。重新截图后，同reviewer判该项resolved，disposition为ship；该最终verdict仅覆盖这项修复。

DESIGN.md和.impeccable/design.json从最终源码token提取。detector运行一次；Inter命中符合用户参考，其余旧设计系统差异由此次获准的文档替换同步，没有新增忽略规则。

## 平台检查与环境修复

Windows首次Release遇到1455提交内存不足，限制Cargo jobs=2并重新构建后通过。Runtime检查会在缺失时下载微软官方引导安装器并校验签名。

CI原生检查最初报CDP连接拒绝：应用和WebView2进程存活，调试参数已传给子进程，但没有进入浏览器命令行。同一CI二进制在本机使用Node.js 24.22.1和WebView2 155.0.4283.62通过。CI的管理员权限触发了WebView2 150起对环境变量浏览器参数的限制，见[上游说明](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5640#issuecomment-4923662109)。CI脚本仅为本程序临时设置HKLM AdditionalBrowserArguments，执行后恢复原值。使用原二进制的[定向检查](https://github.com/MIGO-OvO/USV-GroundStation/actions/runs/41245602625)通过。发布产物的完整Windows CI结果见BUILD_PROVENANCE.json。

原生检查保留30秒期限、真实WebView2、Rust IPC断言和设备未连接检查。应用默认不开启调试端口，CI设置不进入安装包。

一次完整CI中，两项浅色工作区测试超过30秒总期限。trace显示导航、输入、点击和截图普遍变慢，其余五项通过；没有出现业务断言失败。CI改为单个Playwright worker，避免两个软件渲染地图上下文同时争用runner资源，仍执行全部七项测试及原有期限、断言。本机可继续用两个worker。

此前Android构建与SDK版本调整属于旧界面记录，见[android.md](android.md)。本轮未执行Android构建。没有删除失败测试或放宽协议判定。

## 重跑

```powershell
npm ci
cargo fmt --all -- --check
cargo clippy --locked -p usv-core --all-targets -- -D warnings
cargo test --locked -p usv-core
npm test
npm exec playwright -- install chromium
npm run test:ui
npm run tauri -- build --bundles nsis
./tools/ensure-webview2.ps1
node tools/native-smoke.mjs
```

CI只保留Windows runner，执行核心、React、界面、许可证、NSIS及原生WebView2检查。Android工具链记录见[android.md](android.md)，当前CI不执行这些命令。

## 未验证范围

未连接真实飞控、Jetson、ESP32或Android设备，没有执行实船解锁、推进、采样或急停。串口电台、完整USV_SMPL/USV_DONE闭环、真实ROS归档、Android文件选择器及生命周期、干净Windows安装均待 [台架与实船验收](hardware-acceptance.md)。

回环peer、HTTP fixture和UI测试通过不代表上述硬件场景通过。当前版本为预发布，验收记录必须按实际软件和硬件版本填写。

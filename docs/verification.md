# 验证记录

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

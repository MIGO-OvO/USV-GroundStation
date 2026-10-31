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
| `npm run test:ui` | 5通过，0失败 | 1280×720、1920×1080、1024×768、600×900，另测确认框名称/说明/Escape |
| Windows Release / NSIS | 最终构建通过，安装包5.36 MiB | 真实MSVC/Tauri构建，随包包含许可证 |
| `node tools/native-smoke.mjs` | 最终包重跑通过 | 真实Windows WebView2和Rust IPC，不连接设备 |
| Android ARM64 | Release APK构建及签名校验通过 | API26最低、target/compile SDK36、仅arm64-v8a；未安装到设备 |

最终平台产物、签名与校验值随 Release 提供。Android项目专用RSA3072证书SHA256为 `8dad5649db176f60a95712013c0ed3ff44be395f2d9ca36f1f8d29277f30ce66`，已由apksigner验证。APK包含INTERNET权限、原创应用包名及随附许可证。Vite对MapLibre所在JS块提示超过500 kB，构建未失败；此为首版已知体积提示。

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

独立UI复核的首轮三项修正（窄屏主题入口、48px触屏目标、dialog可访问名称与说明）全部评为resolved，verdict为ship；此结论仅覆盖这三项。DESIGN.md和.impeccable/design.json从实际源码token提取。

## 平台检查与环境修复

Windows首次Release遇到1455提交内存不足，限制Cargo jobs=2并重新构建后通过。Android首次生成模板引用SDK37（实际SDK仓库不可用）和AGP9.3.1；本项目通过可重复脚本固定SDK36、根工程及buildSrc的AGP8.13.2、Gradle8.14.3。没有删除失败测试或放宽协议判定。

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
node tools/native-smoke.mjs
```

Android工具链与签名命令见 [android.md](android.md)。CI仅建立Windows安装包和Android APK job，两项均在Windows runner运行。

## 未验证范围

未连接真实飞控、Jetson、ESP32或Android设备，没有执行实船解锁、推进、采样或急停。串口电台、完整USV_SMPL/USV_DONE闭环、真实ROS归档、Android文件选择器及生命周期、干净Windows安装均待 [台架与实船验收](hardware-acceptance.md)。

回环peer、HTTP fixture和UI测试通过不代表上述硬件场景通过。当前版本为预发布，验收记录必须按实际软件和硬件版本填写。

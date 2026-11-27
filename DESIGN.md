---
name: "USV GroundStation"
description: "白灰与炭灰主题、地图优先的极简 Windows 地面站"
colors:
  bg: "#ffffff"
  panel: "#ffffff"
  panel-alt: "#f5f5f5"
  text: "#171717"
  muted: "#666666"
  line: "#e5e5e5"
  accent: "#171717"
  on-accent: "#ffffff"
  accent-soft: "#f0f0f0"
  danger: "#b4232c"
  danger-soft: "#fff1f2"
  warning: "#935514"
  warning-soft: "#fcf4e8"
  success: "#207743"
  info: "#2563eb"
  nav: "#fafafa"
  nav-text: "#666666"
  focus: "#2563eb"
  dark-bg: "#111111"
  dark-panel: "#181818"
  dark-panel-alt: "#222222"
  dark-text: "#f5f5f5"
  dark-muted: "#a3a3a3"
  dark-line: "#303030"
  dark-accent: "#f5f5f5"
  dark-on-accent: "#171717"
  dark-accent-soft: "#2a2a2a"
  dark-danger: "#ff9298"
  dark-danger-soft: "#352024"
  dark-warning: "#e5b675"
  dark-warning-soft: "#30281e"
  dark-success: "#79c99b"
  dark-info: "#8aafff"
  dark-nav: "#151515"
  dark-nav-text: "#a3a3a3"
  dark-focus: "#8aafff"
  map-bg: "#f5f5f5"
  dark-map-bg: "#202020"
  track: "#525252"
  dark-track: "#bdbdbd"
typography:
  headline:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "25px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "16px"
    fontWeight: 600
  panel-title:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
  navigation:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
  caption:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
  metric:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "22px"
    fontWeight: 500
  instrument:
    fontFamily: "Inter, \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"
    fontSize: "23px"
    fontWeight: 500
  mono:
    fontFamily: "Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  state: "3px"
  detail: "4px"
  segmented: "5px"
  control: "6px"
  region: "8px"
  dialog: "10px"
  round: "50%"
spacing:
  tight: "4px"
  control-gap: "7px"
  related: "8px"
  compact: "12px"
  section: "16px"
  panel: "20px"
  region: "24px"
  workspace: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, var(--accent) 82%, var(--muted))"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "36px"
  button-danger-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "36px"
  button-emergency:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "7px 16px"
    height: "36px"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "36px"
  nav-rail:
    backgroundColor: "{colors.nav}"
    textColor: "{colors.nav-text}"
    padding: "28px 12px 18px"
    width: "184px"
  nav-rail-compact:
    width: "168px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
  state-neutral:
    backgroundColor: "{colors.panel-alt}"
    textColor: "{colors.muted}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  state-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  state-succeeded:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  state-failed:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  state-unknown:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  instrument-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.region}"
    padding: "0 20px"
  flat-section:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "20px 0"
  metric:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.metric}"
    padding: "16px 20px"
  waypoint-marker:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.info}"
    rounded: "{rounded.round}"
    padding: "0"
    height: "28px"
    width: "28px"
  waypoint-marker-sampling:
    backgroundColor: "{colors.info}"
    textColor: "{colors.panel}"
  confirmation:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "min(92vw, 500px)"
---

# Design System: USV GroundStation

## Overview

**Creative North Star: "Minimalism"**

视觉方向沿用用户提供的 Minimalism 参考图：白灰底、清楚的文字层级、细线控件和充分留白。深色主题将同一结构换成炭灰。Inter 负责拉丁字符与数字，Microsoft YaHei UI 提供中文回退。

界面围绕现场操作展开。横向图标与文字导航连接五个工作区，地图与读数占驾驶舱主要面积，相关控制在右侧平面分区。主操作使用黑白对比，颜色集中在地图、焦点和状态提示。

**Key Characteristics:**

- 浅色白灰与深色炭灰共用布局、层级和组件。
- 横向导航行、细分隔线与留白组织五个工作区。
- 黑白主操作、蓝色地图与焦点、红色停止和故障各有明确角色。
- 读数、曲线与诊断阶段使用实际接收到的状态。

当前交付目标为 Windows NSIS，重点窗口为（1280×720）和（1920×1080）。设计来源为 `PRODUCT.md`、`.impeccable/surfaces/windows-ui.md`、`src/styles.css`、`src/MapView.tsx`、`src/ui.tsx` 及五个工作区组件。已核对用户参考图和最终 `cockpit-1280.png`、`settings-1280.png`、`diagnostics-1280.png`；设置截图使用深色主题。完整截图清单位于 `.reference/minimalism-captures.json`。

## Colors

白灰与炭灰构成主要面积。前置 token 保留源码色值，`dark-` 同名 token 对应深色主题。

### Primary

- `accent` / `dark-accent`：主操作、当前请求阶段与实时信号线。
- `on-accent` / `dark-on-accent`：实心主操作的文字。
- `accent-soft` / `dark-accent-soft`：选中导航、按下状态和请求标签的中性底色。

### Secondary

- `info` 与 `focus`：地图规划线、航点、船位和键盘焦点；深色主题对应浅蓝。
- `danger` 与 `danger-soft`：停止、急停入口、失败与取消；深色 token 保持同一语义。
- `warning` 与 `warning-soft`：保护提示、未知结果和过期提示。
- `success`：在线连接点和已成功的请求文字。

### Neutral

- `bg`、`panel`、`panel-alt`：工作区、面板与次级底色。
- `text`、`muted`、`line`：主文字、辅助文字和细分隔线。
- `nav`、`nav-text`：侧栏底与默认导航文字。
- `map-bg` / `dark-map-bg`：未加载栅格底图的地图画布。
- `track` / `dark-track`：实际位置形成的中性实线航迹。蓝色规划线采用虚线。

**The 颜色按角色 Rule.** 主操作使用 accent 与 on-accent；地图和焦点使用蓝色，停止与故障使用红色，在线与成功使用小面积绿色。状态同时保留文字。

## Typography

全局字体栈为 Inter、Microsoft YaHei UI、Segoe UI、sans-serif。Inter 由 `src/assets/fonts/InterVariable.woff2` 自托管，覆盖字重（100 至 900），使用 `font-display: swap`。中文采用系统回退。原始诊断与 JSON 使用 Consolas、monospace。

| 角色 | 前置 token | 用途 |
| --- | --- | --- |
| 工作区标题 | `headline` | 当前工作区名称，窄窗口降为（20px） |
| 区块标题 | `title` | 设置、采样和诊断主要区块 |
| 紧凑标题 | `panel-title` | 驾驶舱右侧分组 |
| 正文 | `body` | 按钮、输入和普通说明 |
| 导航 | `navigation` | 横向图标与文字导航行；选中时字重（600） |
| 标签与说明 | `label`、`caption` | 单位、辅助标签和多行说明 |
| 航行读数 | `metric` | 地速、航向和姿态 |
| 采样读数 | `instrument` | 电压与吸光度 |
| 原始详情 | `mono` | JSON 与结构化诊断原文 |

表格正文为（12px），表头和紧凑元信息为（11px），时间线辅助时间为（10px）。JSON 编辑器为（12px）。航行指标在不大于（1280px）时降为（18px），不大于（700px）时降为（16px）。

**The 数字对齐 Rule.** 测量值使用 tabular-nums，单位紧随数值。原始诊断与 JSON 使用 Consolas 等宽字体。

## Layout

桌面外壳使用（184px）侧栏、（68px）顶部状态条和（28px）底部状态条。导航项目为横向图标加中文标签，主题与设置位于侧栏底部。工作区标题区域至少（104px），内边距为（28px 28px 24px）。

驾驶舱地图与右侧操作区相隔（24px），操作区宽（300px）。地图、航行指标和定位电源组成同一个有边界的区域。航线地图与编辑表并排，编辑区宽（440px）。采样进度、读数和信号曲线从上到下排列，右侧操作区宽（310px），按钮按两列等宽对齐。信号曲线随容器宽度铺展，常规高度（260px），短桌面窗口降为（200px），保留最近两分钟的测量；泵组反馈和采样记录位于下方。设置内容宽度上限为（1120px）。

| 窗口条件 | 当前重排 |
| --- | --- |
| 不大于（1280px） | 侧栏（168px）；驾驶舱右栏（268px）；航线编辑区（400px）；标题水平留白（24px） |
| 不大于（960px） | 侧栏（76px），图标与文字上下排列；航线编辑表和采样操作移到对应主内容下方 |
| 不大于（700px） | 导航移至底部；驾驶舱控制移到地图下方；表单变为单列；标题水平留白（16px） |
| 任一粗指针，或不大于（700px） | 触控覆盖规则使用（48px）基准；复选标签和折叠摘要提供同样高度 |

普通按钮与输入基准最小高度为（36px）。密集表格和图标操作保留源码中的紧凑尺寸，触控媒体规则统一放大操作目标。前置 spacing 记录源码复用的间距数值。

**The 留白分组 Rule.** 工作区、地图和操作区通过留白与细线建立关系。常规分区保持平面，地图和信号容器保留边界。

## Elevation & Depth

主要工作区、地图工具与状态标签通过底色、留白和（1px）细线区分。设备确认框使用阴影（`0 16px 64px #00000026`）与遮罩（`#00000066`）。诊断选中标签使用内侧底线（`inset 0 -2px var(--accent)`）。完整 CSS 收录在 sidecar。

**The 模态才浮起 Rule.** 常规面板、地图工具和标签使用底色与描边；设备确认框使用遮罩与集中阴影。

## Shapes

状态标签使用（3px）圆角，辅助详情与地图标签使用（4px），分段选择容器使用（5px），按钮和常规输入使用（6px）。地图、航线、信号与时间线边界使用（8px），确认框使用（10px）。航点和连接点采用圆形。准确值由 `rounded` 提供。

## Components

### Buttons

实心主操作使用 `accent` 与 `on-accent`。普通操作使用面板底与细边框，文本入口使用正文色。停止操作使用危险色文字与浅描边；顶部急停使用透明底和危险色描边，悬停时出现危险软底。

默认尺寸见组件 token；`height` 表示基准最小高度。普通悬停使用次级面板底，主操作悬停使用源码中的（82%）操作色混合。按下使用中性操作软底，禁用时不透明度为（0.46）。背景、边框与文字过渡使用（160ms ease-out）。

### Inputs / Fields

输入、选择器和文本域使用面板底、细边框、控件圆角和蓝色输入光标。占位符沿用 `muted`，不透明度为（1）。聚焦时显示（2px）蓝色轮廓，向外留（3px）；按钮与折叠摘要使用相同焦点。字段禁用时不透明度为（0.5）。错误说明使用危险色和软底。

### Navigation

桌面侧栏项目使用（19px）线性图标、横向标签和至少（44px）的行高。选中项使用中性软底、正文色与半粗字，`aria-current="page"` 标明当前工作区。窄窗口按 Layout 中的断点重排。主题入口只切换浅色与深色，并保存选择。

### Chips / State labels

中性色标签表示待确认；接单和执行阶段使用主文字色与中性软底；成功结果使用小面积绿色文字。失败和取消使用红色与危险软底，未知结果使用琥珀色与警戒软底。模式标签保持辅助文字与次级面板底。

### Containers / Tables

地图与信号区域使用轻描边、区域圆角和面板底。右侧操作区使用透明底，靠垂直间距与细线分组。普通表格采用次级底表头和行分隔线，长表在容器内滚动。采样页展开泵组详情后显示四轴角度仪表、PID 状态、最近一帧 PID 误差、控制状态和设备负载。其他诊断原始 JSON 放入折叠详情，以等宽文本显示。

### Map / Signals

航点与船位使用蓝色，采样航点采用蓝色实心填充。规划航线使用（3px）蓝色虚线；实测航迹使用（3px）中性实线，透明度为（0.8）。实时信号线使用（2px）主操作色。测量值与曲线遵循有效帧、基线和新鲜度；超过（3s）的测量接收间隔断开曲线。无数据时显示等待说明。采样阶段仅高亮当前收到的状态；步骤和循环进度表示当前位置，不代表任务完成。总循环为零时显示“不限”，未知总数不填充进度。四轴角度与 PID 误差沿用三秒遥测有效期；自动化与控制详情标明为最近报告快照，设备健康数据标明报告时间。

### Evidence / Feedback

请求摘要显示命令、时间、session/request 与状态。诊断阶段同时显示图标、文字、来源和接收时间。保护条分别显示推进上锁和载荷停止的证据。提交反馈使用“操作已提交，等待设备回执”。

**The 证据逐项确认 Rule.** 创建、发送、标准 ACK、关联接单、设备进度和终态分别显示；阶段按收到的证据更新，缺失阶段显示未确认。

### Confirmation

原生模态 dialog 使用“确认设备操作”标题与目标说明，分别通过 `aria-labelledby` 和 `aria-describedby` 关联。取消、关闭与 Escape 共用关闭路径。提交期间显示“提交中”并禁用操作按钮。

界面只保留状态变化的短过渡；系统请求减少动态效果时关闭 CSS 过渡与动画。地图跟随使用（250ms）中心移动。

## Do's and Don'ts

### Do:

- Do 使用现有浅色与深色语义变量，保持黑白主操作与中性导航。
- Do 用细线、留白和文字层级组织地图、操作、读数与诊断。
- Do 保留占位符的完整辅助文字色和键盘焦点轮廓。
- Do 在较窄 Windows 窗口重排内容，并保留已有触控目标覆盖规则。
- Do 为设备操作显示目标、确认入口和真实回执状态。

### Don't:

- Don't 增加第三种主题，或把绿色扩展成主操作与导航色。
- Don't 用装饰性阴影、重复卡片或嵌套侧栏分割主要任务。
- Don't 把标准 ACK、接单或提交完成显示为设备任务成功。
- Don't 用示例读数、随机曲线或虚构记录填充等待区域。

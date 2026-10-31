---
name: "USV GroundStation"
description: "地图优先、状态与证据清楚对应的无人船操作工作区"
colors:
  bg: "#f1f4f3"
  panel: "#fafcfb"
  panel-alt: "#edf2ef"
  text: "#173137"
  muted: "#52686c"
  line: "#d1ddd7"
  accent: "#146b52"
  accent-soft: "#e2eee7"
  danger: "#b33036"
  danger-soft: "#fae9e7"
  warning: "#975916"
  warning-soft: "#fcf0dd"
  nav: "#142c31"
  nav-text: "#bbcfc9"
  focus: "#237857"
  dark-bg: "#102327"
  dark-panel: "#193136"
  dark-panel-alt: "#203b3f"
  dark-text: "#e5efec"
  dark-muted: "#afc2bf"
  dark-line: "#3a5357"
  dark-accent: "#6ac5a2"
  dark-accent-soft: "#23473f"
  dark-danger: "#ff9396"
  dark-danger-soft: "#4d2c32"
  dark-warning: "#efbe73"
  dark-warning-soft: "#473a28"
  dark-nav: "#0e2024"
  dark-nav-text: "#afc2bf"
  dark-focus: "#82d9b7"
  nav-active: "#285149"
  nav-active-text: "#e5f2e9"
  nav-hover: "#274348"
  map-bg: "#e5ece7"
  dark-map-bg: "#203a3b"
  track: "#1a8c65"
  route: "#bb6a23"
  waypoint-bg: "#faf4e8"
  waypoint-text: "#7e4115"
typography:
  headline:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "16px"
    fontWeight: 600
  panel-title:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
  caption:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
  metric:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "22px"
    fontWeight: 500
  instrument:
    fontFamily: "\"Segoe UI\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", sans-serif"
    fontSize: "23px"
    fontWeight: 500
  mono:
    fontFamily: "Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  state: "3px"
  field: "4px"
  control: "5px"
  dialog: "8px"
spacing:
  tight: "4px"
  control-gap: "7px"
  related: "8px"
  compact: "12px"
  section: "16px"
  panel: "20px"
  workspace: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, var(--accent) 88%, var(--text))"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-danger-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-emergency:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "7px 18px"
    height: "36px"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "7px 9px"
    height: "34px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    rounded: "{rounded.control}"
    padding: "10px 4px"
    height: "65px"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-text}"
  state-neutral:
    backgroundColor: "{colors.panel-alt}"
    textColor: "{colors.muted}"
    rounded: "{rounded.state}"
    padding: "4px 7px"
  state-confirmed:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
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
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    padding: "19px 20px"
  metric:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.metric}"
    padding: "16px 20px"
  confirmation:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "min(92vw, 500px)"
---

# Design System: USV GroundStation

## Overview

**Creative North Star: "地图优先的操作台"**

界面供现场操作员持续观察无人船并完成航行、航线和采样操作。顶部状态条保持连接与急停入口可见，窄导航把主要面积留给当前任务。中文使用短标签，读数、状态和操作就近排布。

深绿操作色、冷灰绿色底和细分隔线构成工业控制界面。面板以平面分区组织密集信息，地图浮层与确认框使用有限阴影。浅色与深色主题共享布局和语义角色。

**Key Characteristics:**

- 地图与任务内容占主要面积，控制面板贴近相关状态。
- 中文短标签、紧凑表格和等宽数字便于连续扫描。
- 操作、告警和停止使用稳定的颜色与文字组合。
- 等待、过期、提交和终态分别呈现已有证据。

提取依据：`src/styles.css`、`src/ui.tsx`、`src/App.tsx`、`src/MapView.tsx`、`src/Planner.tsx`、`src/PayloadWorkspace.tsx`、`src/Diagnostics.tsx` 与 `src/Settings.tsx`。产品方向来自 `PRODUCT.md` 和 `.impeccable.md`。核对了 `.impeccable/review/cockpit-1280.png`、`settings-600.png` 和 `confirmation-600.png`；截图呈现浏览器预览和交互测试状态。

## Colors

主操作采用深绿，深色主题将操作色提高到浅绿。背景、面板与分隔线使用带绿色倾向的中性色。前置 token 保留源码色值；同名 `dark-` token 对应深色主题。

### Primary

- `accent` / `dark-accent`：主操作、在线状态、曲线与已观察到的阶段。
- `accent-soft` / `dark-accent-soft`：模式标签、执行状态与轻量反馈底色。
- `focus` / `dark-focus`：键盘焦点轮廓。
- `track`：已接收位置形成的实线航迹。

### Secondary

这里记录语义信号，不另设品牌辅助色。

- `danger` 与对应软底、深色 token：急停、停止入口、失败与取消。
- `warning` 与对应软底、深色 token：保护提示、结果未知和过期提示。
- `route`、`waypoint-bg`、`waypoint-text`：规划航线和编号航点。规划线使用虚线，采样航点使用实心填充。

### Neutral

- `bg`、`panel`、`panel-alt`：工作区底、可操作面板和次级底色。
- `text`、`muted`、`line`：主要文字、辅助文字和结构分隔。
- `nav`、`nav-text`：导航底与默认文字；`nav-active`、`nav-active-text` 和 `nav-hover` 保留两种主题共用的导航状态。
- `map-bg` / `dark-map-bg`：未加载栅格底图时的地图画布。

**The 状态同名 Rule.** 深浅主题替换同一语义变量；红色用于停止和失败，琥珀色用于未知与警戒。每个状态同时显示文字。

## Typography

正文沿用系统字体栈：Segoe UI、Microsoft YaHei UI、Noto Sans CJK SC、sans-serif。诊断原文使用 Consolas、monospace。界面通过字号、字重和位置区分层级。

| 角色 | 前置 token | 用途 |
| --- | --- | --- |
| 工作区标题 | `headline` | 当前工作区名称；窄屏降为（20px） |
| 区块标题 | `title` | 设置、采样和诊断的主要区块 |
| 面板标题 | `panel-title` | 右侧控制面板的紧凑分组 |
| 正文 | `body` | 按钮、输入和普通说明 |
| 辅助标签 | `label`、`caption` | 标签、单位和多行辅助说明 |
| 航行指标 | `metric` | 地速、航向和姿态 |
| 采样读数 | `instrument` | 电压与吸光度主读数 |
| 原始详情 | `mono` | 结构化诊断原文；JSON 编辑器使用（12px） |

表格正文使用（12px），表头和紧凑元信息使用（11px）；时间线辅助时间使用（10px）。航行指标在不大于（1280px）时降为（18px），窄屏降为（16px）。字体大小随角色变化，不扩张标题来占据地图空间。

**The 数字对齐 Rule.** 测量值使用 tabular-nums，单位紧随数值；原始 JSON 和诊断详情使用等宽字体。

## Layout

桌面外壳采用（76px）窄导航、（58px）顶部状态条和（27px）底部状态条。工作区填满剩余高度；主要滚动发生在面板、设置、数据与诊断内容内部。默认工作区标题区域至少（84px），水平留白（24px）。

驾驶舱让地图占据剩余宽度，右侧面板默认（320px）；航线编辑区默认（440px）。地图下方的航行指标使用同一行平面分栏。采样区将信号与载荷操作并排，原始反馈与数据归档继续向下排列。设置内容宽度上限为（1120px）。

| 条件 | 当前布局 |
| --- | --- |
| 不大于（1280px） | 驾驶舱右栏（290px），航线编辑区（420px），工作区水平留白（20px） |
| 不大于（960px） | 驾驶舱右栏（270px）；航线地图与编辑表上下排列；采样操作移到信号区下方 |
| 不大于（700px） | 外壳改为（54px）状态条、主内容和（58px）底部导航；驾驶舱控制区移到地图下方；表单改为单列 |
| 任一粗指针，或不大于（700px） | 按钮、图标按钮和常规输入至少（48px）；复选标签和折叠摘要提供同样高度 |

普通按钮与输入基准高度为（34px）；桌面密集表格和图标操作保留源码中的紧凑尺寸。触控覆盖规则统一提高操作目标，导航项目保留其更大的原始高度。前置 spacing 是源码中复用数值的提取，源码当前没有另设命名间距变量。

**The 内容先重排 Rule.** 窄屏先把面板移到内容下方，再调整导航与表单；表格保留横向滚动。

## Elevation & Depth

工作区、表格和控制面板通过底色和（1px）细线分开。地图工具、地图标签使用轻阴影（`0 2px 8px #142c3112`）；确认框使用集中阴影（`0 16px 60px #071c3050`）和遮罩（`#071c3060`）。诊断页选中标签通过内侧底线表示（`inset 0 -2px var(--accent)`）。这些值收录在 sidecar，常规分区不新增浮起效果。

**The 分区在平面 Rule.** 常规工作区使用底色和细线分区；阴影用于覆盖地图的工具和模态确认。

## Shapes

标签使用最小圆角，输入稍大，按钮和地图工具再放宽一级，确认框使用最大圆角。准确尺寸见 `rounded`。主要面板与表格使用直角边界；航点、连接点和阶段图标使用圆形语义标记。圆角用于区分交互对象，不把整页包进圆角卡片。

## Components

### Buttons

主操作使用实心操作色和面板色文字，普通按钮使用面板底与细边框。停止操作使用危险色文字与浅描边，顶部急停使用实心危险色。文本入口保留操作色，图标入口带可访问名称。

默认内边距和高度见组件 token；其中 `height` 记录基准最小高度，布局允许内容撑高。悬停将底色切到次级面板，主操作使用源码中的 `color-mix`。按下使用操作软底。禁用按钮降低不透明度（0.46），同时保留标签。背景和文字变化使用（140ms ease-out）。

### Inputs / Fields

输入、选择器和文本域共用细边框、面板底和输入圆角。占位符使用辅助文字色。键盘聚焦显示（2px）焦点轮廓，向外留（3px）；按钮、折叠摘要同样支持此焦点。字段禁用时降低不透明度（0.5）。错误说明使用危险色与软底，贴近相关操作。

### Navigation

桌面导航为图标上、中文标签下的窄栏，主要项目高度至少（65px）。选中项使用固定导航高亮色和浅色文字；`aria-current="page"` 标明当前工作区。窄屏改为底部横向导航，设置页内的主题选择器继续提供深浅主题入口。

### Chips / State labels

状态标签采用紧凑文字与软底。中性色显示待确认，绿色显示关联接单、执行中或已完成，危险色显示失败或取消，琥珀色显示结果未知。标签文字继续区分具体阶段。

### Containers / Tables

面板以边线和内部间距组织信息。普通表格表头使用次级底，数据行使用底部分隔线，长内容在表格容器内滚动。航点表保持纬度、经度、采样超时与排序入口的对应关系。原始 JSON 放在折叠详情内，用等宽文本显示。

### Metrics / Signals

航行指标使用辅助标签、大读数和小单位。测量值遵循有效帧与基线状态，分别显示未更新、已过期、无有效帧、未设基线或未知。实时信号只绘制已收到的有效测量帧；超过（3s）的接收间隔断开曲线。无数据时显示等待原因。

### Evidence / Feedback

请求摘要显示命令、时间、session/request 和当前状态。诊断时间线依次显示创建、发送、标准 ACK、关联接单、设备进度和终态事件；阶段使用圆点或确认图标，同时保留说明和时钟来源。保护条分别显示推进上锁与载荷停止的证据。

**The 证据逐项确认 Rule.** 提交反馈使用等待回执的文案；标准 ACK、关联接单、设备进度和终态事件各自显示。缺少证据的阶段保持未确认。

### Confirmation

设备确认使用原生模态 dialog。标题为“确认设备操作”，操作正文说明目标与动作；通过 `aria-labelledby` 和 `aria-describedby` 提供名称和说明。取消、关闭与 Escape 退出使用同一路径。提交时按钮显示“提交中”并禁用，操作反馈继续等待设备回执。

界面仅保留状态反馈所需的短过渡；系统请求减少动态效果时关闭 CSS 过渡与动画。

## Do's and Don'ts

### Do:

- Do 复用语义颜色和既有字体、间距、圆角；深浅主题保持同一信息层级。
- Do 把状态文字、数值单位和相关操作放在同一区域。
- Do 在粗指针设备或不大于 700px 的视口保留 48px 操作目标，并支持键盘焦点。
- Do 用已收到的测量帧和事件填充读数、曲线与时间线；空状态说明下一步。
- Do 为设备确认框保留操作目标、可访问名称、取消和关闭入口。

### Don't:

- Don't 用装饰性卡片、重复信息或嵌套侧栏分割主要任务区域。
- Don't 把接单、标准 ACK 或提交完成显示为设备任务成功。
- Don't 用随机曲线、补点连线或虚构记录填充无数据区域。
- Don't 为紧凑布局缩小触控模式中的 48px 操作目标，或移除状态文字与焦点。

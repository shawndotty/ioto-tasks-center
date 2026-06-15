## 概要

为任务中心中的“链接类 Badge”增加可区分的背景配色，并提供一个统一设置项控制样式模式。

目标效果：

- 默认使用多彩配色，便于一眼区分不同 Badge 类型
- 子任务 Badge：`#02ca1d`
- 输入出链 Badge：`#008ffd`
- 输出出链 Badge：`#f3982a`
- 成果出链 Badge：`#e241f4`
- 在插件“基本设置”中新增“任务列表链接 Badge 背景色”设置
  - 默认：多彩配色
  - 可选：单色背景
- 当用户选择“单色背景”时，恢复为当前统一背景样式
- 需要同步处理多语言

## 当前状态分析

### Badge 样式现状

- 当前所有链接类 Badge 共用 `styles.css` 中的同一套背景样式：
  - [styles.css:L937-L959](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L937-L959)
- 目前 `.ioto-tasks-center__task-outlink-count` 使用统一的 `color-mix(var(--interactive-accent)...)` 背景
- 子任务 Badge 复用了同一基础类，并额外加了语义类：
  - [iotoTasksCenterView.ts:L1100-L1112](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1100-L1112)
  - class 为 `ioto-tasks-center__task-outlink-count ioto-tasks-center__task-subtask-count`
- 出链 Badge 会通过 `data-outlink-category` 标记 `input/output/outcome`：
  - [iotoTasksCenterView.ts:L1126-L1176](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1126-L1176)

### 设置结构现状

- 设置模型在 [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L42-L84)
- 任务中心 view 的构造参数由 [main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L52-L79) 注入 getter
- 设置页“基本设置”中已经有“任务出链”“子任务”等区域，适合新增一个枚举型下拉设置：
  - [settings.ts:L307-L382](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L307-L382)
- `settings.ts` 已存在“下拉模式设置”的实现模式，可直接复用：
  - [settings.ts:L498-L519](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L498-L519)

## 设计决策

- 设置范围：只影响任务列表里的“链接类 Badge”背景
  - 包括：子任务 Badge、输入出链 Badge、输出出链 Badge、成果出链 Badge
  - 不影响：优先级 Badge、核心任务星标、状态 Badge
- 设置方式：单一枚举配置 `multicolor | monochrome`
- 默认值：`multicolor`
- “单色背景”模式下完全保留当前样式逻辑，不改变现有颜色算法

## 改动方案

### 1) 新增 Badge 背景模式配置

**文件**
- 修改：`src/settings.ts`

**改动**
- 新增类型：
  - `export type TaskLinkBadgeBackgroundMode = 'multicolor' | 'monochrome';`
- 在 `IOTOTasksCenterSettings` 中新增字段：
  - `taskLinkBadgeBackgroundMode: TaskLinkBadgeBackgroundMode`
- 在 `DEFAULT_SETTINGS` 中默认：
  - `taskLinkBadgeBackgroundMode: 'multicolor'`
- 新增选项 helper：
  - `getTaskLinkBadgeBackgroundModeOptions(): Record<TaskLinkBadgeBackgroundMode, string>`
- 在“基本设置”中新增一个下拉设置项，位置放在“任务出链”与“子任务”区域附近，文案表达为“任务列表链接 Badge 背景色”

### 2) 主插件接入设置更新

**文件**
- 修改：`src/main.ts`

**改动**
- 在创建 `IOTOTasksCenterView` 时增加 getter：
  - `() => this.settings.taskLinkBadgeBackgroundMode`
- 新增更新方法：
  - `updateTaskLinkBadgeBackgroundMode(mode: TaskLinkBadgeBackgroundMode): Promise<void>`
- 保存后调用 `applySettingsToOpenViews()`，保证切换设置后立即刷新任务中心

### 3) 任务中心 view 输出模式类

**文件**
- 修改：`src/views/iotoTasksCenterView.ts`

**改动**
- 在构造函数参数中新增 getter：
  - `getTaskLinkBadgeBackgroundMode: () => TaskLinkBadgeBackgroundMode`
- 在渲染链接类 Badge 时附加一个模式类到每个 Badge，或更优地给列表根节点附加模式类：
  - 推荐方案：给任务列表容器或 view 根节点增加
    - `ioto-tasks-center--task-link-badge-multicolor`
    - `ioto-tasks-center--task-link-badge-monochrome`
- 保持现有子任务语义类 `ioto-tasks-center__task-subtask-count`
- 保持现有出链 `data-outlink-category="input|output|outcome"` 标记

**原因**
- 使用“容器模式类 + 现有语义类/属性选择器”即可纯 CSS 切换，不需要改动 Badge 文本或 Popover 逻辑
- 也能兼容出链 Badge 的增量更新逻辑：新建出来的 Badge 只要保留现有 class/data 属性，颜色会自动生效

### 4) CSS：实现多彩 / 单色两套背景

**文件**
- 修改：`styles.css`

**改动**
- 保留当前 `.ioto-tasks-center__task-outlink-count` 的基础尺寸、圆角、字体等通用样式
- 将“当前统一背景色”迁移到 `monochrome` 模式下，例如：
  - `.ioto-tasks-center--task-link-badge-monochrome .ioto-tasks-center__task-outlink-count { ...当前 background/color... }`
- 新增 `multicolor` 模式下的分类背景：
  - 子任务：
    - `.ioto-tasks-center--task-link-badge-multicolor .ioto-tasks-center__task-subtask-count { background: #02ca1d; }`
  - 输入出链：
    - `.ioto-tasks-center--task-link-badge-multicolor .ioto-tasks-center__task-outlink-count[data-outlink-category="input"] { background: #008ffd; }`
  - 输出出链：
    - `.ioto-tasks-center--task-link-badge-multicolor .ioto-tasks-center__task-outlink-count[data-outlink-category="output"] { background: #f3982a; }`
  - 成果出链：
    - `.ioto-tasks-center--task-link-badge-multicolor .ioto-tasks-center__task-outlink-count[data-outlink-category="outcome"] { background: #e241f4; }`
- 文本颜色统一改为适合深色纯色背景的前景色，建议在 `multicolor` 模式下使用浅色文本（如 `#fff` 或 `var(--text-on-accent)` 若主题兼容性足够）

### 5) 多语言文案

**文件**
- 修改：
  - `src/lang/locale/zh-cn.ts`
  - `src/lang/locale/zh-tw.ts`
  - `src/lang/locale/en.ts`

**新增键**
- `settings.taskLinkBadges.backgroundMode.name`
- `settings.taskLinkBadges.backgroundMode.desc`
- `settings.taskLinkBadges.backgroundMode.multicolor`
- `settings.taskLinkBadges.backgroundMode.monochrome`

**建议文案**
- zh-CN
  - `settings.taskLinkBadges.backgroundMode.name`: `任务列表链接 Badge 背景色`
  - `settings.taskLinkBadges.backgroundMode.desc`: `设置子任务和任务出链 Badge 使用多彩配色或单色背景。`
  - `settings.taskLinkBadges.backgroundMode.multicolor`: `多彩配色`
  - `settings.taskLinkBadges.backgroundMode.monochrome`: `单色背景`
- zh-TW / en 对应翻译同步补齐

## 验证方式

### 自动验证

- `npm run build`
- `npm run lint`

### 手动验证

- 默认安装/升级后，不改设置时：
  - 子任务 Badge 为 `#02ca1d`
  - 输入出链 Badge 为 `#008ffd`
  - 输出出链 Badge 为 `#f3982a`
  - 成果出链 Badge 为 `#e241f4`
- 设置切换为“单色背景”后：
  - 所有链接类 Badge 恢复当前统一底色样式
- 来回切换设置时：
  - 已打开的任务中心视图无需重启即可刷新
- 创建/删除子任务、编辑出链导致新 Badge 动态出现时：
  - 新出现的 Badge 也能继承当前模式颜色

## 假设与边界

- 本次只改“背景色模式”，不增加每种 Badge 的自定义颜色输入框
- 本次不调整 Popover 配色，只调整任务列表中的 Badge
- 本次不改变 Badge 的显示条件与数量逻辑，仅改变视觉区分方式

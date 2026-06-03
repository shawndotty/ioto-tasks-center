# 任务中心 Tab 宽度响应式修复计划

## Summary

目标是修复任务中心当前自适应设计中的两个问题：

- 响应式断点不应基于整个 Obsidian 窗口宽度，而应基于“任务中心所在 tab 的实际可用宽度”
- 当 tab 宽度过小、进入仅显示任务列表的紧凑模式时，项目切换器应显示在“任务列表模块的上方”，而不是放在任务模块内部

本次不包含：

- 调整 720px 断点数值
- 调整任务列表业务逻辑
- 新增用户可配置的响应式断点设置

## Current State Analysis

### 1. 当前响应式判断完全依赖 CSS `@media`

文件：

- `styles.css`

已确认现状：

- 当前存在：
  - `@media (max-width: 900px)`
  - `@media (max-width: 720px)`
- 这些规则本质上都是基于浏览器/应用窗口 viewport 宽度触发
- 在 Obsidian 中，单个 pane / tab 可以被自由拖拽改变宽度，因此 viewport 宽度不能准确代表某个 tab 的实际宽度

结论：

- 当前实现会在“窗口足够宽，但某个 tab 很窄”的情况下失效
- 响应式模式必须改为依据任务中心视图根节点或其容器宽度进行判断

### 2. 当前项目切换器渲染在任务 pane 内部

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- `render()` 当前结构是：
  - 创建 `.ioto-tasks-center`
  - 在其内部创建：
    - `.ioto-tasks-center__pane--projects`
    - `.ioto-tasks-center__pane--tasks`
- 项目切换器当前在 `renderTasksPane()` 内创建
- 实际 DOM 位置是：
  - 任务 pane 标题区之后
  - 说明文案之前
  - 也就是“任务列表模块内部”，不是“任务列表模块上方”

结论：

- 这与用户期望不一致
- 若要显示在任务列表模块上方，切换器应从 `renderTasksPane()` 中移出，改为在任务 pane 外层单独渲染

### 3. 当前代码没有 tab 宽度监听机制

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 当前没有：
  - `ResizeObserver`
  - 针对 `contentEl` 或视图根节点的尺寸监听
  - `compact mode` 之类的运行时 state

结论：

- 要基于 tab 实际宽度切换布局，最自然的方式是：
  - 使用 `ResizeObserver` 监听 `this.contentEl` 或视图主容器宽度
  - 在视图实例上维护一个 `isCompactLayout` 或等价布尔状态
  - 根据该状态给根容器加类名

### 4. 当前 900px / 720px 样式规则需要收敛职责

文件：

- `styles.css`

已确认现状：

- `@media (max-width: 900px)` 当前负责紧凑双列
- `@media (max-width: 720px)` 当前负责隐藏左栏、显示项目切换器
- 由于它们都依赖 viewport，因此一旦改成基于 tab 宽度，现有 `720px` 媒体查询将不再适合作为唯一触发条件

结论：

- 执行时应把“是否进入紧凑模式”的核心判断，从纯媒体查询迁移到运行时 class
- `900px` 的样式策略也要重新定义：
  - 要么保留为视觉微调
  - 要么同步改成由类名控制

## Proposed Changes

### 1. 在视图层增加基于 tab 实际宽度的紧凑模式状态

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 为视图实例新增响应式状态，例如：
  - `private isCompactLayout = false`
- 在视图生命周期中注册 `ResizeObserver`
- 监听对象优先建议：
  - `this.contentEl`
  - 或 `render()` 创建后的主容器元素
- 在宽度 `<= 720px` 时，将 `isCompactLayout` 设为 `true`
- 宽度 `> 720px` 时，将其设回 `false`

原因：

- 这是唯一能精确按“当前任务中心所在 tab 的宽度”判断的可靠方案

实现要点：

- 需要避免无意义重复 `render()`：
  - 仅在紧凑状态发生变化时才重新渲染
- 监听应通过 `this.register()` 或等效清理机制在 view unload 时释放
- 若初次渲染时还没有准确尺寸，应在首次 mount 后立即同步一次状态

### 2. 把根容器切换为 class 驱动布局，而不是依赖 `@media (max-width: 720px)`

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

变更内容：

- 在 `render()` 中根据 `isCompactLayout` 给根元素添加明确类名，例如：
  - `.ioto-tasks-center--compact`
- 样式层改为优先根据该类控制：
  - 是否隐藏左侧项目 pane
  - 是否让任务 pane 占满宽度
  - 是否显示项目切换器

原因：

- 这样布局切换将直接由 tab 实际宽度驱动，不再依赖整个窗口尺寸

实现要点：

- `@media (max-width: 720px)` 中与布局切换强相关的规则应删除或下沉为类规则
- 避免出现“类名判定”和“媒体查询判定”双重控制同一布局的冲突

### 3. 将项目切换器从任务 pane 内部移到任务模块上方

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

变更内容：

- 当前项目切换器从 `renderTasksPane()` 中移除
- 在 `render()` 中于任务模块外层单独渲染一个小屏切换区，例如：
  - 根容器先渲染一个 `compact-topbar`
  - 再渲染 `.ioto-tasks-center`
- 或者渲染一个“任务模块包装层”，结构示意：
  - 小屏项目切换器
  - 任务 pane

推荐结构：

- `root`
  - `.ioto-tasks-center__compact-toolbar`
  - `.ioto-tasks-center`
    - `.ioto-tasks-center__pane--projects`
    - `.ioto-tasks-center__pane--tasks`

原因：

- 这样项目切换器会明确位于“任务列表模块上方”
- 与用户期望的视觉层级一致

实现要点：

- 小屏切换器仍复用现有 `Menu` 交互
- 只是在 DOM 位置上移出任务 pane
- 切换器默认仅在 `isCompactLayout === true` 时显示

### 4. 保留现有项目切换逻辑，仅调整入口位置与可见条件

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 复用已存在的：
  - `canSwitchProjects()`
  - `getProjectSwitcherLabel()`
  - `showProjectSwitcherMenu()`
- 只调整其：
  - 渲染位置
  - 可见性
  - 可能需要的 class 命名

原因：

- 当前项目切换菜单逻辑已经存在，没有必要重新设计

实现要点：

- 当前项目、禁用态、加载态文案都应继续保留
- 迁移位置后要确保点击事件和选中状态不受影响

### 5. 重构响应式样式职责

文件：

- `styles.css`

变更内容：

- 将与“小宽度模式”强绑定的样式迁移为类控制，例如：
  - `.ioto-tasks-center--compact .ioto-tasks-center__pane--projects { display: none; }`
  - `.ioto-tasks-center--compact .ioto-tasks-center__pane--tasks { width: 100%; }`
  - `.ioto-tasks-center__compact-toolbar { ... }`
- 现有 `@media (max-width: 900px)` 保留为纯视觉微调，或也收拢为更温和的布局规则

建议职责划分：

- 运行时 class：
  - 控制是否进入紧凑模式
  - 控制左栏隐藏、右栏占满、切换器显示
- 媒体查询：
  - 仅做非关键的视觉微调
  - 或在本次顺手收敛，避免未来混淆

原因：

- 这样能完全解决“按窗口宽度而不是 tab 宽度判断”的问题

### 6. 验证小宽度下的交互与边界行为

文件：

- 无新增源码文件，仅为执行阶段验证范围

验证重点：

- 同一 Obsidian 窗口中：
  - 当任务中心所在 tab 本身宽度缩小到 `<= 720px` 时，进入紧凑模式
  - 即便整个窗口很宽，也能正确进入紧凑模式
- 当 tab 宽度放大到 `> 720px` 时，恢复双栏
- 紧凑模式下：
  - 项目切换器显示在任务列表模块上方
  - 左栏项目列表隐藏
  - 右栏任务列表正常显示
- 切换项目后：
  - 任务列表刷新正常
  - 搜索、tab、设置按钮、分组折叠不受影响

## Assumptions & Decisions

- 720px 断点继续保留，但判断依据改为“任务中心所在 tab 的实际宽度”
- 采用 `ResizeObserver + 运行时 class` 方案，不再依赖纯 CSS `@media` 做主判定
- 小屏项目切换器保留现有 `Menu` 交互逻辑，只调整其位置和显示方式
- “显示在任务列表模块上方”的解释为：
  - 项目切换器位于任务 pane 外部的上方区域
  - 而不是任务 pane 内部 header/description 之间

## Verification Steps

1. 宽度判定验证
   - 调整单个任务中心 tab 宽度时，紧凑模式按 tab 宽度切换
   - 不再受整个 Obsidian 窗口宽度误导

2. 布局位置验证
   - 紧凑模式下项目切换器显示在任务模块上方
   - 不再显示在任务 pane 内部

3. 交互验证
   - 项目切换器可正常切换项目
   - 当前项目文案、禁用态、加载态都正确

4. 功能兼容验证
   - 任务搜索正常
   - tab 筛选正常
   - 设置按钮正常
   - 分组折叠正常
   - 优先级显示正常

5. 自动化与静态检查
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

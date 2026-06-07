# 任务右键菜单新增“核心任务”标记 - 开发计划（2026-06-07）

## Summary

在任务列表的右键菜单中，新增两项与“核心任务”相关的操作：

- 标记为核心任务
- 取消核心任务标记

这两个菜单项需要出现在现有“优先级”菜单项的上方，并且与优先级部分之间使用横线分隔。

当用户点击这两个菜单项时，插件应直接修改对应任务笔记 frontmatter 中的 `Starred` 属性值，以实现核心任务的标记与取消标记。

同时需要补充完整的多语言文案。

## Current State Analysis

- 任务列表右键菜单入口位于 [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 任务行在 `renderTaskRows()` 中绑定了 `contextmenu` 事件
  - 当前右键触发的是 `showTaskPriorityMenu(event, task)`
- 当前右键菜单实现位于 [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1966-L1994)
  - 若当前任务已有优先级，会先显示“取消优先级”
  - 然后通过 `menu.addSeparator()` 与优先级选项分隔
  - 再依次显示 `P0` 到 `P9`
- 当前优先级写回逻辑位于：
  - [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2128-L2167)
  - 视图层使用 `updateTaskPriority()` / `clearTaskPriority()`，内部调用任务写入 helper，成功后统一 `refreshCurrentProjectTasks()`
- 当前优先级 frontmatter 写入 helper 位于 [task-priority.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-priority.ts)
  - 已有较成熟的 frontmatter 标量属性 upsert / remove 模式
  - 适合复用同样的策略为 `Starred` 做写入
- 当前任务数据读取层已经支持读取 `Starred`
  - [data.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts) 已包含 `getTaskFileStarred()`、`parseStarredFrontmatterValue()`、`resolveStarredFromSources()` 等逻辑
  - `TaskFileEntry` 已有 `starred: boolean` 字段，因此右键菜单可直接根据 `task.starred` 决定显示哪项操作
- 当前多语言文案已有“优先级菜单”和错误提示相关键：
  - [zh-cn.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
  - [zh-tw.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
  - [en.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- 当前已有优先级写入测试：
  - [task-priority.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-priority.test.mjs)
  - 可作为 `Starred` 写入测试的直接参考

## Assumptions & Decisions

- 右键菜单命名仍沿用当前实现入口 `showTaskPriorityMenu()`，实现时可视情况保留函数名或重命名为更泛化名称，但不改变其调用位置和交互入口
- “标记为核心任务”与“取消核心任务标记”使用互斥显示：
  - `task.starred === false` 时显示“标记为核心任务”
  - `task.starred === true` 时显示“取消核心任务标记”
- “核心任务”菜单项放在优先级菜单区域的上方，并在它们之后调用一次 `menu.addSeparator()`，保证与优先级区域之间有横线
- 若当前任务已有优先级，保留现有“取消优先级”逻辑和其后的优先级列表，不改变原优先级菜单行为
- `Starred` 的写入规则固定为：
  - 标记时写入 `Starred: true`
  - 取消标记时移除 `Starred` 属性，而不是写成 `Starred: false`
- 标记 / 取消标记成功后，沿用现有优先级操作模式，统一刷新当前项目任务列表，以便：
  - 任务行数据中的 `starred` 状态更新
  - “核心任务”tab 内任务列表立即同步
- 失败提示沿用现有 `Notice` 模式，并新增独立的 Starred 错误文案

## Proposed Changes

### 1) 新增 `Starred` frontmatter 写入 helper

新增文件：`src/tasks-center/task-starred.ts`

- 参考 [task-priority.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-priority.ts) 的结构，提供两个公开方法：
  - `setTaskFileStarred(app, file): Promise<void>`
  - `clearTaskFileStarred(app, file): Promise<void>`
- 内部统一封装为一个 frontmatter 标量属性更新流程：
  - 标记为核心任务时：写入 `Starred: true`
  - 取消核心任务标记时：移除 `Starred`
- frontmatter 处理规则与 `Priority` helper 保持一致：
  - 没有 frontmatter 时自动创建
  - 已有 frontmatter 时覆盖已有 `Starred`
  - 移除 `Starred` 时保留其他属性
  - 若 frontmatter 最终为空，则按现有模式清理空 frontmatter
- 不把这部分混入 `task-priority.ts`
  - 原因：`Priority` 与 `Starred` 是不同业务域，分文件更利于维护和测试

### 2) 扩展任务右键菜单，插入“核心任务”操作

修改文件： [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 在文件顶部新增导入：
  - `setTaskFileStarred`
  - `clearTaskFileStarred`
- 保持 `renderTaskRows()` 中 `contextmenu` 事件入口不变，仍从任务行打开该菜单
- 调整 `showTaskPriorityMenu(event, task)` 的菜单构建顺序：
  1. 根据 `task.starred` 显示单个核心任务切换项
     - 未标记：显示“标记为核心任务”
     - 已标记：显示“取消核心任务标记”
  2. 调用 `menu.addSeparator()`，与优先级区域隔开
  3. 继续渲染现有优先级相关项
     - 若已有优先级，则显示“取消优先级”
     - 若已有优先级且后面还有 `P0-P9` 项，则保留现有优先级内部的分隔线
  4. 渲染 `P0-P9`
- 这样最终菜单结构将是：
  - 核心任务切换项
  - 横线
  - 取消优先级（如果当前存在优先级）
  - 横线（仅当前存在优先级时）
  - P0-P9

### 3) 在视图层新增 Starred 更新方法并复用现有刷新/错误处理模式

修改文件： [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 新增两个私有方法：
  - `updateTaskStarred(task: TaskFileEntry): Promise<void>`
  - `clearTaskStarred(task: TaskFileEntry): Promise<void>`
- 方法流程与 `updateTaskPriority()` / `clearTaskPriority()` 保持一致：
  - 根据 `task.path` 获取 `TFile`
  - 文件不存在时提示 `view.notice.taskFileUnavailable`
  - 调用 `setTaskFileStarred()` / `clearTaskFileStarred()`
  - 成功后调用 `refreshCurrentProjectTasks()`
  - 失败时通过 `Notice` 显示新的多语言错误提示
- 不额外引入新的 UI 状态字段
  - 当前优先级更新也未使用单独 loading state
  - 保持交互风格一致，避免无必要扩大修改范围

### 4) 补充多语言文案

修改文件：

- [zh-cn.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
- [en.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

- 新增菜单项文案键：
  - `view.taskCoreMenu.set`
  - `view.taskCoreMenu.clear`
- 新增错误提示文案键：
  - `view.notice.updateTaskCoreFailed`
  - `view.notice.clearTaskCoreFailed`
- 文案建议：
  - 简中：
    - `标记为核心任务`
    - `取消核心任务标记`
    - `更新核心任务标记失败。`
    - `取消核心任务标记失败。`
  - 繁中：
    - `標記為核心任務`
    - `取消核心任務標記`
    - `更新核心任務標記失敗。`
    - `取消核心任務標記失敗。`
  - 英文：
    - `Mark as core task`
    - `Clear core task mark`
    - `Failed to update core task mark.`
    - `Failed to clear core task mark.`

### 5) 补充自动化测试

新增文件：`tests/task-starred-write.test.mjs`

- 参考 [task-priority.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-priority.test.mjs) 的模式，对 `task-starred.ts` 做写入测试
- 至少覆盖：
  - 设置 `Starred` 时会创建 frontmatter
  - 设置 `Starred` 时会保留其他 frontmatter
  - 设置 `Starred` 时会覆盖已有 `Starred`
  - 取消 `Starred` 时会移除该属性并保留其他属性
  - 取消 `Starred` 后若 frontmatter 为空，保持与现有 helper 一致的输出行为

可选测试增强（若实现中抽出纯菜单构建辅助函数）：

- 为右键菜单的显示顺序加一个纯函数级测试，验证：
  - 核心任务项在优先级区域之前
  - 两区域之间存在分隔
  - 已标记/未标记时菜单项互斥

若不抽纯函数，则不强行添加 UI 层菜单测试，避免低价值测试。

## Verification Steps

- 运行单元测试：`npm test`
- 运行构建验证：`npm run build`
- 手工验收（Obsidian）：
  - 在任务列表中右键一个普通任务，确认菜单顶部先出现“标记为核心任务”
  - 确认其下方有横线，再进入优先级相关项
  - 点击“标记为核心任务”后，确认对应任务文件 frontmatter 写入 `Starred: true`
  - 重新打开右键菜单，确认菜单项变为“取消核心任务标记”
  - 点击“取消核心任务标记”后，确认 `Starred` 属性被移除
  - 若当前处于“核心任务”tab，确认标记/取消后列表即时刷新
  - 确认原有优先级设置与取消优先级功能未回归

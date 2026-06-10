# 计划：任务列表为核心任务显示黄色星标

## Summary

- 在任务中心的任务列表中，当用户通过右键菜单把某个任务标记为核心任务后，该任务行需要有明确的可视反馈。
- 目标效果是：像优先级 badge 一样，在任务元素上显示一个黄色 `⭐` 图标。
- 该图标放在优先级 badge 的后面、状态 badge 的前面。

## Current State Analysis

- `TaskFileEntry` 已经包含 `starred: boolean` 字段，见 [types.ts:L44-L57](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts#L44-L57)。
- `Starred` 的读写链路已经完整存在：
  - 解析与数据来源：`data.ts` 中已有 `parseStarredFrontmatterValue / resolveStarredFromSources / getStarredFromContent`
  - 写回 frontmatter：见 [task-starred.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-starred.ts#L1-L118)
  - 右键菜单切换：`showTaskPriorityMenu()` 中已通过 `updateTaskStarred()` / `clearTaskStarred()` 调用写回，见 [iotoTasksCenterView.ts:L2510-L2563](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2510-L2563)
- 当前任务行渲染位于 [renderTaskRows](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L952-L1178)：
  - 目前会渲染标题、出链 badge、优先级 badge、状态 badge
  - 但没有任何 `task.starred` 对应的可视元素
- 现有优先级 badge 样式位于 [styles.css:L1020-L1050](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L1020-L1050)
  - 这段样式已经确定了任务行右侧 badge 的视觉语言
  - 新的核心任务星标应与这一区域保持一致，不应插到标题前或状态后
- 现有语言包中已存在：
  - `view.taskCoreMenu.set`
  - `view.taskCoreMenu.clear`
  - `task.filter.core`
  - 但没有“核心任务星标”的 ariaLabel/title 专用文案

## Assumptions & Decisions

- 星标只在 `task.starred === true` 时显示。
- 星标展示采用用户指定的黄色 `⭐` 字符，而不是改成 Obsidian icon 或 SVG。
- 星标位置固定在：
  - 优先级 badge 之后
  - 状态 badge 之前
- 即使当前关闭了“显示优先级”设置，只要任务是核心任务，星标仍应显示；因为它表达的是另一种状态，不应依赖优先级显示开关。
- 本次只补充任务列表中的可视反馈，不改右键菜单文案与交互。

## Proposed Changes

### 1) 在任务行中渲染核心任务星标

**文件**：`src/views/iotoTasksCenterView.ts`

- 在 `renderTaskRows()` 中，保持现有顺序：
  1. 标题
  2. 出链 badge
  3. 优先级 badge（如有）
  4. **核心任务星标（新增）**
  5. 状态 badge
- 新增渲染逻辑：
  - 当 `task.starred` 为 `true` 时，创建一个 `span`
  - 类名建议：`ioto-tasks-center__task-core-badge`
  - 文本内容：`⭐`
- 可访问性：
  - 为该元素增加 `ariaLabel`
  - 可选增加 `title`
  - 文案应通过 i18n 提供，例如“核心任务”
- 这样在用户右键标记为核心任务后，当前任务行能立即出现可见标记，与优先级 badge 的反馈方式保持一致。

### 2) 为核心任务星标补充样式

**文件**：`styles.css`

- 在优先级 badge 样式附近新增核心任务星标样式，保持任务行右侧徽标区的一致性。
- 建议样式：
  - `flex: 0 0 auto`
  - `display: inline-flex`
  - `align-items: center`
  - `justify-content: center`
  - 适度字号，建议略大于状态文字、接近 badge 高度
  - 颜色使用黄色系，如 `var(--color-yellow)`；若需兼容主题，可使用 `color-mix`
  - 不需要 pill 背景时，可只显示黄色星标；若视觉上太轻，可给一个很浅的黄色背景与圆角
- 目标是“明显但不过分喧宾夺主”，和优先级 badge / 状态 badge 能放在同一行稳定显示。

### 3) 补充星标可访问性文案

**文件**：
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

- 新增一个专用于任务行星标的文案 key，例如：
  - `view.taskCoreBadge.label`
- 文案建议：
  - zh-cn: `核心任务`
  - zh-tw: `核心任務`
  - en: `Core task`
- 用途：
  - `ariaLabel`
  - 如需要也可作为 `title`

### 4) 测试策略

**文件**：
- 视情况决定是否仅保留现有业务测试，不强行新增 UI 测试

- 当前 `Starred` 的读写和解析已经有测试，见 [task-starred.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-starred.test.mjs#L1-L68)
- 本次变更主要是 view 层展示，不一定适合为 DOM 片段专门引入低价值测试
- 计划优先：
  - 不新增复杂的视图 UI 测试
  - 通过 `npm test / build / lint` 和 Obsidian 手动验收保证质量
- 如果实现过程中顺手能提炼出一个纯函数（如“是否显示核心星标”），可再考虑补一个轻量测试；否则不额外增加噪音测试。

## Verification Steps

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）：
  1. 在任务列表中右键一个任务，选择“标记为核心任务”
  2. 确认该任务行立即出现黄色 `⭐`
  3. 如果该任务也有优先级，确认 `⭐` 显示在优先级 badge 后面
  4. 确认 `⭐` 显示在状态 badge 前面
  5. 再次右键取消核心任务标记，确认 `⭐` 消失
  6. 验证没有优先级的任务被标记为核心任务时，仍然会显示 `⭐`


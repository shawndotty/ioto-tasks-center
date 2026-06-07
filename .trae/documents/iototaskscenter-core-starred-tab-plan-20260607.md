# 任务中心新增“核心任务”Tab - 开发计划（2026-06-07）

## Summary

在任务中心右侧现有 4 个 tab:

- 今天
- 未完成
- 已完成
- 全部

在 **全部** 后新增一个 **核心任务** tab。

该 tab 仅显示 **当前选中项目** 下，frontmatter 属性 `Starred` 为 `true` 的任务笔记。

## Current State Analysis

- 任务中心 tab 定义集中在 [task-filter-tabs.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-filter-tabs.ts)
  - `TaskFilterTab` 当前仅包含 `today | incomplete | completed | all`
  - `getTaskFilterTabs()` 决定 tab 顺序和文案
  - `getTaskFilterCounts()` 和 `matchesTaskFilterTab()` 负责计数与筛选逻辑
- 任务中心视图在 [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - `loadTasks(projectName)` 只会加载 **当前选中项目** 的任务文件
  - `renderTaskTabs()` 通过 `getTaskFilterTabs()` 渲染 tab，并通过 `getTaskFilterCounts()` 显示数量
  - `getTasksForActiveTab()` 通过 `matchesTaskFilterTab()` 在当前项目任务集合上做过滤
  - 这意味着“当前项目”在现有实现里已经有明确含义: 左侧项目列表当前选中的项目
- 任务文件数据来源在 [data.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts)
  - `listProjectTaskFiles()` 读取当前项目文件夹下所有 markdown 任务文件，并组装 `TaskFileEntry`
  - 已有 `Priority`、`UpTask` 的 frontmatter 解析模式，可复用同样的读取方式扩展 `Starred`
- 任务数据类型在 [types.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts)
  - `TaskFileEntry` 目前还没有 `starred` 字段
- 多语言文案位于:
  - [zh-cn.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
  - [zh-tw.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
  - [en.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- 现有筛选测试在 [task-filter-tabs.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-filter-tabs.test.mjs)
  - 适合直接补充 “核心任务” tab 的合法性、匹配和计数测试

## Assumptions & Decisions

- “当前项目”按现有任务中心语义处理: 即左侧项目列表当前选中的项目，不做跨项目汇总
- “核心任务”放在 **全部** 后面，顺序为: `今天 -> 未完成 -> 已完成 -> 全部 -> 核心任务`
- `Starred` 作为 frontmatter 属性名按用户描述使用精确大小写 `Starred`
- 业务判定以 “真值” 为准:
  - `metadataCache.frontmatter.Starred === true` 时命中
  - 为了兼容正文 frontmatter / metadata cache 的差异，实现时同时兼容正文中 `Starred: true` 与回退值 `"true"` / `'true'` 的情况
- “核心任务”tab 仅按 `Starred` 过滤，不额外限制任务状态:
  - 已完成但 `Starred: true` 的任务也应显示
  - 未完成且 `Starred: true` 的任务也应显示
- 默认激活 tab 仍保持现状 `today`，不改变已有初始行为

## Proposed Changes

### 1) 扩展任务数据结构，携带 starred 状态

修改文件: [types.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts)

- 为 `TaskFileEntry` 新增字段:
  - `starred: boolean`
- 保持该字段为必填布尔值，避免 UI 层再做 `undefined` 判断

修改文件: [data.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts)

- 在 `listProjectTaskFiles()` 组装任务条目时新增 `starred`
- 参考已有 `Priority` / `UpTask` 的实现方式，增加专门的 `Starred` 读取逻辑:
  - `getTaskFileStarred(app, file): Promise<boolean>`
  - `resolveStarredFromSources({ content, metadataValue }): boolean`
  - `getStarredFromContent(content): boolean`
  - `parseStarredFrontmatterValue(value): boolean`
- 解析规则固定为:
  - `true` 布尔值返回 `true`
  - 字符串去引号、去空白后为 `true` 时返回 `true`
  - 其他任何值统一返回 `false`
- 继续沿用当前容错模式:
  - 优先读取 `cachedRead(file)` 正文 frontmatter
  - 读取失败时回退到 `metadataCache.frontmatter?.Starred`

### 2) 新增 “核心任务” tab 类型、文案和匹配逻辑

修改文件: [task-filter-tabs.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-filter-tabs.ts)

- 将 `TaskFilterTab` 扩展为:
  - `'today' | 'incomplete' | 'completed' | 'all' | 'core'`
- 在 `getTaskFilterTabs()` 中把 `{ key: 'core', label: t('task.filter.core') }` 追加到 `all` 后面
- 在 `isTaskFilterTab()` 中加入 `value === 'core'`
- 在 `getTaskFilterCounts()` 中新增 `core` 计数
- 在 `matchesTaskFilterTab()` 中新增分支:
  - `tab === 'core'` 时返回 `task.starred`
- 保持其他 tab 逻辑不变，避免影响现有 “今天/未完成/已完成/全部”

修改文件:

- [zh-cn.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
- [en.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

- 新增文案键:
  - `task.filter.core`
- 文案建议:
  - 简中: `核心任务`
  - 繁中: `核心任務`
  - 英文: `Core`

### 3) 利用现有任务中心渲染流程，无需重做 UI 结构

涉及文件: [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 该文件大概率只需依赖类型扩展后自动获得新行为，不一定需要显式改动
- 现有流程已经会自动:
  - 遍历 `getTaskFilterTabs()` 渲染 tab 按钮
  - 读取 `getTaskFilterCounts()` 显示数量
  - 在 `getTasksForActiveTab()` 中按 `matchesTaskFilterTab()` 过滤列表
  - 通过 `isTaskFilterTab()` 校验 view state 中持久化的 tab key
- 实施时若 TypeScript 因 `Record<TaskFilterTab, number>` 或状态默认值出现类型错误，再只做最小化修正，不改动交互模式

### 4) 补充测试，覆盖筛选与 Starred 解析

修改文件: [task-filter-tabs.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-filter-tabs.test.mjs)

- 扩展 `createTask()` 测试工厂，加入 `starred` 字段默认值 `false`
- 增加至少这些用例:
  - `core` 是合法 tab
  - `Starred` 为真时匹配 `core`
  - `Starred` 为假时不匹配 `core`
  - `getTaskFilterCounts()` 正确统计 `core`
  - `all / completed / incomplete / today` 在新增字段后保持原有行为

建议新增文件: `tests/task-starred.test.mjs`

- 单测 `data.ts` 中的纯解析函数，覆盖:
  - `true` 布尔值
  - `"true"` / `'true'` / 带空白字符串
  - `false` / `"false"` / 空值 / 非布尔字符串
  - 正文 frontmatter 优先于 metadata cache 的场景
- 如果实现后发现现有 `data.ts` 导出的函数不足以直接测试，可将 `parseStarredFrontmatterValue` 与 `resolveStarredFromSources` 设计为导出函数

## Verification Steps

- 运行单元测试: `npm test`
- 运行构建验证: `npm run build`
- 手工验收（Obsidian）:
  - 打开任务中心，确认 tab 顺序为 `今天 / 未完成 / 已完成 / 全部 / 核心任务`
  - 在某个项目下准备多个任务文件，其中部分 frontmatter 为 `Starred: true`
  - 切换到 **核心任务** tab，确认只显示当前项目内被标记为 `Starred: true` 的任务
  - 确认 `核心任务` tab 数量与实际命中文件数一致
  - 切回其他 4 个 tab，确认原有筛选与数量未回归
  - 重开任务中心，确认新 tab 可正常恢复和使用

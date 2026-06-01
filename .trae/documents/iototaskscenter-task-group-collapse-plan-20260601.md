# 任务列表分组折叠展开计划

## Summary

目标是在任务列表启用“按任务状态分组”时，为每个分组增加折叠/展开能力。

本次已确认的交互决策：

- 仅在“按任务状态分组”模式下提供折叠/展开
- 首次进入分组视图时，各分组默认“全部展开”
- 折叠状态仅在“当前任务中心视图”内记住
- 关闭视图后不持久化，不写入插件全局设置

本次不包含：

- 在“不分组”模式下提供折叠
- 将分组折叠状态同步到插件设置页
- 将折叠状态跨 Obsidian 重启持久化
- 自定义默认折叠规则

## Current State Analysis

### 1. 当前任务分组只渲染静态标题，没有可交互 header

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 任务列表在 `renderTasksSection()` 中先获取 `presentationSections`
- 当前按 section 渲染时，结构为：
  - `.ioto-tasks-center__task-group`
  - 可选的 `.ioto-tasks-center__task-group-title`
  - 分组内任务行
- `section.label` 只用于显示文本，没有按钮语义、点击事件或折叠 state

结论：

- 折叠/展开的最佳接入点就在现有 section 渲染循环内
- 需要把“标题 div”升级为“可点击 header/button”
- 需要在视图类中增加每个分组的折叠状态管理

### 2. 分组数据模型目前只包含 `key`、`label` 和 `tasks`

文件：

- `src/views/task-list-presentation.ts`

已确认现状：

- `TaskPresentationSection` 当前字段为：
  - `key`
  - `label`
  - `tasks`
- `groupTasksForPresentation()` 在 `groupMode === 'status'` 时按固定顺序返回非空分组：
  - `todo`
  - `in-progress`
  - `completed`
  - `empty`
- `groupMode === 'none'` 时返回单个 `all` section，`label` 为 `null`

结论：

- 当前 section 结构已经有稳定 `key`，足够作为折叠 state 的索引键
- 若需要在标题里显示任务数量，可直接从 `tasks.length` 推导，不一定要改动纯逻辑模块

### 3. 当前样式只有分组标题视觉，没有展开/折叠交互样式

文件：

- `styles.css`

已确认现状：

- `.ioto-tasks-center__task-group` 当前只是普通列布局
- `.ioto-tasks-center__task-group-title` 当前是 sticky 标题条
- 没有以下样式：
  - 分组 header 按钮
  - 箭头/chevron 图标旋转
  - 折叠后的内容容器隐藏
  - 折叠/展开 hover、focus 状态

结论：

- 需要把分组标题从纯文本条改造成交互式 header
- 需要补充折叠图标与内容容器的样式状态类
- sticky 行为需要保留，但应挂在新的 header 元素上

### 4. 当前设置模型不适合保存本次折叠状态

文件：

- `src/settings.ts`
- `src/main.ts`

已确认现状：

- 全局设置当前只保存任务列表的排序和分组模式
- 用户已明确希望折叠状态仅在当前视图中记住

结论：

- 本次不需要扩展 `IOTOTasksCenterSettings`
- 折叠状态应放在 `IOTOTasksCenterView` 内部 state
- 需要确保重新渲染、切换项目、切换 tab 和搜索后 state 仍可复用

## Proposed Changes

### 1. 在视图类中新增“分组折叠状态”视图级 state

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在 `IOTOTasksCenterView` 中新增一个仅当前视图生效的折叠状态容器，例如：
  - `private collapsedTaskGroups = new Set<string>();`
- 仅使用 section `key` 作为索引键：
  - `todo`
  - `in-progress`
  - `completed`
  - `empty`
- 新增辅助方法，例如：
  - `isTaskGroupCollapsed(sectionKey: string): boolean`
  - `toggleTaskGroupCollapsed(sectionKey: string): void`
  - `syncCollapsedTaskGroups(sections): void`

原因：

- 用户要求“当前视图记住”，视图级 state 正好满足
- `Set<string>` 能简单表达“哪些组已收起”

实现要点：

- 默认情况下 `collapsedTaskGroups` 为空，表示首次进入时全部展开
- 每次渲染时，应把当前已不存在的分组 key 从集合中清理掉，避免切换项目/筛选后残留无效 key
- `groupMode === 'none'` 时不使用折叠 state

### 2. 把分组标题升级为可点击的折叠 header

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 当前 section 渲染从“静态标题 + 任务列表”改为：
  - 分组容器
  - 可点击 header 按钮
  - 分组内容容器
- header 建议包含：
  - 左侧 chevron 图标
  - 分组标题文本
  - 该组任务数量
- 点击 header 时切换展开/折叠

原因：

- 这是最符合现有 DOM 结构的最小侵入改法
- 也更符合 Obsidian 面板中常见的 section header 交互

实现要点：

- 仅当 `section.label` 存在时渲染可交互 header；`none` 模式下不额外渲染
- 使用 `button` 元素而不是 `div`，天然支持键盘可访问性
- 为按钮提供：
  - `aria-expanded`
  - `aria-controls`
  - 明确的 `title` / `aria-label`
- 组内容容器在折叠时不渲染任务行，或渲染容器但加隐藏类；执行阶段二选一时优先选择“保留容器、条件跳过任务行渲染”的简单实现

### 3. 为 header 加入展开/折叠图标和状态类

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

变更内容：

- 复用 Obsidian `setIcon()` 给分组 header 中的图标容器设置 chevron 类图标
- 根据展开状态为分组容器或 header 添加状态类，例如：
  - `.is-collapsed`
  - `.is-expanded`

原因：

- 让用户一眼识别当前分组是否展开

实现要点：

- 图标建议使用 `chevron-right` / `chevron-down`，或固定同一个图标配合 CSS 旋转
- 优先采用“固定一个 icon + CSS transform 旋转”的方案，避免每次切换都重新 setIcon
- 旋转只作用于图标，不影响标题文本

### 4. 为分组内容补充折叠后的结构与样式

文件：

- `styles.css`

变更内容：

- 现有 `.ioto-tasks-center__task-group-title` 可拆分为更明确的类，例如：
  - `.ioto-tasks-center__task-group-header`
  - `.ioto-tasks-center__task-group-header-icon`
  - `.ioto-tasks-center__task-group-header-label`
  - `.ioto-tasks-center__task-group-header-count`
  - `.ioto-tasks-center__task-group-body`
- 当分组折叠时：
  - 隐藏 body
  - 调整 header 的边框/圆角以保持视觉完整

原因：

- 当前样式只适合纯文本标题，不足以支撑交互式 header

实现要点：

- 保留 sticky 效果在 header 上，而不是原来的纯文本标题类
- hover、focus-visible、active 状态应与现有按钮风格协调
- 折叠后不要影响任务列表整体滚动
- 若分组 body 被隐藏，避免出现多余间距

### 5. 让折叠状态与现有筛选/搜索/项目切换共存

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在基于 `presentationSections` 渲染前，先同步可用分组 key
- 切换 tab、搜索关键字、切换项目、刷新任务数据后：
  - 仍沿用当前视图里已记录的折叠状态
  - 但仅作用于本次仍然存在的分组
- 如果某组因筛选结果变空而消失，再次出现时视为“默认展开”，除非同一次视图生命周期内仍保留其 key 记录

原因：

- 这是“当前视图记住”与“动态数据过滤”之间最自然的折中

实现要点：

- 计划执行时建议采用如下规则：
  - 对当前 `presentationSections` 做 key 集合
  - 把 `collapsedTaskGroups` 中不在当前 key 集合内的条目移除
- 这样可避免状态无限累积，也符合“当前界面可见分组”的记忆范围

### 6. 补充单测与手动验证范围

文件：

- `tests/task-list-presentation.test.mjs`
- 可能新增单独视图辅助函数测试文件，或保持手动验证

变更内容：

- 纯逻辑模块本身不负责折叠 UI，因此不需要把折叠 state 硬塞进 `task-list-presentation.ts`
- 若执行阶段把“清理可用分组 key”抽成纯函数，可为其补充单测
- UI 部分以手动验证为主，重点检查：
  - 折叠/展开是否立即生效
  - 同一视图重新渲染后状态是否保留
  - 切换项目、tab、搜索后是否符合预期

原因：

- 当前仓库测试基建更适合纯函数，不适合直接做复杂 DOM 交互集成测试

## Assumptions & Decisions

- 折叠/展开仅在 `taskListGroupMode === 'status'` 时生效
- 初次进入分组模式时所有分组默认展开
- 折叠状态保存在 `IOTOTasksCenterView` 内存 state 中，不持久化
- 分组 header 使用可点击 `button` 元素
- header 上展示组名与该组任务数量，便于用户决定是否展开
- 折叠时隐藏该组任务 body，不隐藏 header
- 切换项目、tab、搜索、排序后，当前视图内仍沿用折叠状态；但不存在的组 key 会被清理
- 不改动排序/分组设置菜单的行为，只扩展已分组视图的展示交互

## Verification Steps

1. 基础交互验证
   - 启用“按任务状态分组”后，每个分组标题可点击
   - 点击一次折叠，再点一次展开
   - 图标方向与 `aria-expanded` 状态一致

2. 默认状态验证
   - 首次切换到“按任务状态分组”时，所有可见分组默认展开

3. 当前视图记忆验证
   - 手动折叠一个或多个分组
   - 触发视图重新渲染后，折叠状态仍保留
   - 关闭该视图并重新打开后，分组恢复默认展开

4. 与筛选/搜索共存验证
   - 切换“今天 / 未完成 / 已完成 / 全部” tab，折叠状态行为正常
   - 输入搜索条件后，仅剩部分分组时不报错
   - 清空搜索后重新出现的分组按既定规则展示

5. 与项目切换共存验证
   - 在项目 A 折叠某些组后切换到项目 B
   - 若项目 B 也存在同名状态组，其默认是否保留当前视图折叠状态应符合实现规则
   - 无任务组消失/出现时不会产生异常渲染

6. 视觉与可访问性验证
   - sticky header 仍正常工作
   - 折叠/展开按钮 hover、focus-visible 状态清晰
   - 窄宽度下标题、数量和图标不挤压错位

7. 静态与构建验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- `styles.css`
- 可选：新增一个视图辅助函数测试文件，或在现有测试文件旁新增纯函数测试

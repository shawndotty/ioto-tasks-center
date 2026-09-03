# 紧凑布局下任务行精简显示方案

## Summary

在紧凑布局（视图宽度 ≤ 720px，含移动端与窄标签页）下，任务行只保留：任务名、缩进结构（含子任务展开/收起的 chevron 图标）、批量编辑复选框（功能性交互）。隐藏所有信息类标记：子任务计数 badge、出链 badge（输入/输出/成果）、优先级 badge（P0-P3）、核心任务星标、状态 badge（待开始/进行中/已完成/空）。宽屏布局完全不变。

## Current state analysis

- [task-row-renderer.ts](src/views/tasks-center/task-row-renderer.ts) 的 `renderTaskRows` 为每个任务行渲染：

  - 批量编辑复选框（L78-82，`view.isBatchEditMode` 时）

  - 标题区：chevron 子任务开关（L87-101）+ 标题文本（L102-105）

  - 子任务计数 badge（L106-119，条件 `view.getShowTaskSubtaskCount()`）

  - 出链 badge 组（L120-182，条件 `view.getShowTaskOutlinkCounts()` 等）

  - 优先级 badge（L183-191，条件 `view.getShowTaskPriority()`）

  - 核心任务星标（L192-199，条件 `task.starred`）

  - 状态 badge（L200-207，无条件渲染）+ 状态 checklist popover 绑定

- 紧凑状态：`iotoTasksCenterView.ts` L198 `private isCompactLayout = false;`，由 `ResizeObserver` + `COMPACT_LAYOUT_BREAKPOINT`(720) 驱动，跨越断点时整树 `render()`（L903-917）。属性当前为 **private**，渲染子模块无法访问（同文件中 `isBatchEditMode` 等均为 public，改成 public 符合现有惯例）。

- **关键坑**：[outlink-badge-sync.ts](src/views/tasks-center/outlink-badge-sync.ts) 的 `updateTaskOutlinkBadges`（L25-81）会在 metadata 变化时（`queueOutlinkBadgeUpdate`，视图 L359 触发）对已渲染 DOM **重建**出链 badge。若只在渲染时条件跳过，紧凑模式下 metadata 一变 badge 就会"复活"，必须同步加紧凑短路。

- 行布局：`.ioto-tasks-center__task-row` 为 `display: flex; justify-content: space-between`（styles.css L830-853），badge 侧隐藏后标题自然占满，无需 CSS 改动。

- 缩进由 CSS 变量 `--ioto-task-indent-level`（L48 `rowEl.style.setProperty`）实现，不受影响。

## Proposed Changes

### 1. `src/views/iotoTasksCenterView.ts`

L198：`private isCompactLayout = false;` → `isCompactLayout = false;`（去 private，供渲染子模块读取）。

### 2. `src/views/tasks-center/task-row-renderer.ts`

在 `renderTaskRows` 内为 5 个信息类标记块加 `!view.isCompactLayout` 条件（chevron、标题、复选框、事件绑定均不动）：

- 子任务计数 badge：`if (view.getShowTaskSubtaskCount())` → `if (!view.isCompactLayout && view.getShowTaskSubtaskCount())`（连带跳过 `bindTaskSubtaskPopover`）

- 出链 badge：`if (view.getShowTaskOutlinkCounts())` → `if (!view.isCompactLayout && view.getShowTaskOutlinkCounts())`（连带跳过 `metadataCache.resolvedLinks` 查询与 `bindTaskOutlinkPopover`）

- 优先级 badge：`if (view.getShowTaskPriority() && ...)` → `if (!view.isCompactLayout && view.getShowTaskPriority() && ...)`

- 核心任务星标：`if (task.starred)` → `if (!view.isCompactLayout && task.starred)`

- 状态 badge + checklist popover：整块 `if (!view.isCompactLayout) { ... }` 包裹（L200-207）

### 3. `src/views/tasks-center/outlink-badge-sync.ts`

`updateTaskOutlinkBadges` 开头（L29）加紧凑短路，防止 metadata 变化时在紧凑模式重建 badge：

```ts
if (!view.getShowTaskOutlinkCounts() || view.isCompactLayout) {
    return;
}
```

### 4. 文档

- `docs/USER_GUIDE.md`：在 badge 相关条目（outlink counts 一节附近）补一句：紧凑布局（移动端/窄标签页）下任务行仅显示任务名与子任务展开标记，计数/状态/优先级/核心等 badge 自动隐藏。

- `docs/USER_GUIDE.zh-CN.md`：对应章节同步一句。

## Assumptions & Decisions

- 复用现有 `isCompactLayout` 断点（720px），不新增设置项、不引入 `Platform.isMobile`——断点已同时覆盖移动端与桌面拖窄。

- 保留批量编辑复选框：它是交互控件而非信息展示，隐藏会导致紧凑模式下批量选择不可用。

- 保留 chevron 子任务开关：这是"任务缩进标记"的组成部分，隐藏后子任务在紧凑模式无法展开/收起。

- 状态隐藏后已完成/未完成任务在紧凑模式无视觉区分——按用户明确要求"其他的就都不显示了"处理。

- 渲染逻辑为 DOM 组装，无纯函数变更，不新增单测（与现有 task-row-renderer 无测试的现状一致）；全量回归既有测试。

- CSS 无需改动（flex 布局自动适配）。

## Verification

1. `npm run build` — tsc + esbuild 通过。
2. `npm test` — 270 个既有测试通过。
3. `npm run lint` — 不引入新问题（main.ts 预存的 7 个问题不在范围）。
4. 手动验证：

   - 宽屏：任务行 badge 与改动前完全一致。

   - 拖窄至 ≤720px：任务行只剩任务名 + 缩进 + chevron；批量编辑模式复选框仍可用。

   - 窄模式下修改笔记出链（触发 metadata 变化）：出链 badge 不应"复活"。

   - 子任务展开/收起、点击打开任务、拖拽、右键菜单均正常。

   - 移动端验证同样表现。


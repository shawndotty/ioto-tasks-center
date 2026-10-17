# Task View Section 拖拽排序 实现计划

## Repository Research

### 现状：Task View 内没有任何指针拖拽

- Task View（单文件卡片视图）里任务排序的既有路径是**键盘** Alt+↑↓：`swapSelectedTask()`（[task-view-task-commands.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/task-view-task-commands.ts#L445-L521)），其写盘范式可直接照搬：守卫（flush 在册编辑 / exitZoom / 撤删除遮罩）→ 纯函数算区间 → `commitBlockRange(app, file, {startLine,endLine,originalLines,nextText})` 一次原子区间重写 → `applyOutcome` → 行号迁移 → `renderNote`。
- 仓内已有两套成熟拖拽范式可参考：
  - 桌面 HTML5 DnD：`src/views/tasks-center/drag-controller.ts`（Tasks center 跨文件改父任务）；
  - **Pointer Events 统一手势**：[touch-gesture.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/tasks-center/touch-gesture.ts)（touch 长按 400ms + 位移 10px 阈值才进入拖拽、未长按的滑动交还原生滚动、`setPointerCapture`、自建 ghost、`elementFromPoint` 命中、`touchmove preventDefault`）。本方案手势引擎照此口径，一套代码同时服务鼠标与触摸（Obsidian 插件须移动兼容，不能用 HTML5 DnD）。

### Section 结构与渲染

- `parseSections()`（[note-sections.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/note-sections.ts)）产出 `NoteSection{level,startLine,endLine,title}`；顶层块（roots）由栈算法算出，渲染层副本在 [getTopLevelSections()](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/render-sections.ts#L122-L149)。嵌套标题的 `endLine` 已含在父块内 → **整块搬运 roots 即可连带子标题与全部正文**。
- roots 按行号升序、区间连续无缝：root 之间的空行在解析上属于前一块尾部；第一个 root 之前是 frontmatter + 引导区（`prefix`），最后一个 root 的 `endLine = lines.length-1`（文末只有空行）。
- 每个顶层标题块渲染为 `<section class="ioto-task-view__section" data-level data-start-line data-end-line>`，header 是 sticky flex 行：chevron 折叠钮 + 标题 + 右侧 actions（pencil / x，仅内联编辑态）。折叠时只渲染 header（[render-sections.ts:169-177](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/render-sections.ts#L151-L181)）。
- 折叠态 key = `` `${level}:${startLine}:${title}` ``，跨结构变更按行号/文本迁移已有先例 [shiftTrackedLines()](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/task-view-filters.ts#L85-L113)。
- `renderTaskNote()` 每次整树重建 scrollEl，按钮监听随 DOM 丢弃、无需 `register*`（与 section-edit / add-section 按钮同生命周期）。

### 门禁与互斥（与上一轮「新增 Section 加号」完全同口径）

- **只读**（`!supportsInlineEdit()`）：不渲染拖拽手柄。
- **「只显示任务」(onlyTaskBlocks)**：roots 是过滤子集，跨隐藏块排序语义不可预测 → 该态不渲染手柄（与底部加号显隐一致）；`onlyPending` / `recentOnly` / 关键词搜索不影响（它们不过滤 section）。
- **Section 整块编辑态**：隔离态下其它 section 已 CSS 隐藏；当前编辑块的手柄 CSS 隐藏。
- **卡片放大态**：手势启动时 `zoomLine !== null` 直接 bail（提交前的 flush 也会兜底），并加 CSS 隐藏手柄双保险。

## 设计决策（关键）

1. **入口**：每个顶层标题块 header 的 actions 区首位加一个**无文字图标手柄**（lucide `grip-vertical`，样式与 pencil/x 按钮同款：透明底、2px padding、muted），符合「无文字标签 + padding/对齐一致」偏好。引导区（level 0）无 header，天然不可拖。
2. **手势**：Pointer Events 单实现。鼠标：手柄上按下移动 >8px 即拖；触摸：须先长按 400ms 再移动才进入拖拽，否则整次触摸交还原生滚动（防碍滚动列表）。拖拽中 `setPointerCapture` 到 header、`touchmove preventDefault`、跟手 ghost（显示 section 标题）、源块半透明、目标 header 上/下显示 2px 落点横线（before/after，按指针在目标块 rect 中点的哪一侧）。拖到滚动容器上下边缘 48px 内自动滚动（rAF）；命中空白/底部加号行 = 移到最后。Esc / pointercancel 取消。
3. **落点语义**：N 个标题块有 N+1 个槽位（首块之前 … 末块之后）；落在与当前等价的槽位 = no-op（纯函数返回 `null`，静默不写盘）。
4. **提交**：松手一次落点 → 纯函数重排 → `commitBlockRange` 原子写（Obsidian 自动获得撤销栈）→ `applyOutcome` → 折叠 key / selectedLine 按 `mapLine` 精确迁移 → `renderNote`。拖拽过程纯 DOM 态，**不写盘、不重绘**。
5. **空行规范化原则**：只统一「顶层块之间」为恰好一个空行；frontmatter/引导区（prefix）原样不动；文件末尾空行形态（如结尾换行）按原数量保留。块内部（含嵌套标题、代码块、列表）零改动。

## Files and Modules

### 新建

- `src/tasks-center/note-section-reorder.ts` — **纯函数 + 类型**（零 DOM / 零 obsidian，可单测）：
  ```ts
  export interface SectionReorderResult {
    startLine: number;      // commitBlockRange 区间首（= 第一个标题块行）
    endLine: number;        // = 文件末行
    originalLines: string[];// lines.slice(startLine)
    nextLines: string[];    // 重组后对应切片
    mapLine(line: number): number | null; // 旧行号→新行号；被规范化的尾空行→null
  }
  export function reorderTopLevelSections(
    content: string,
    fromStartLine: number,
    targetStartLine: number,
    position: 'before' | 'after',
  ): SectionReorderResult | null; // 参数无效 / 无标题块 / 顺序未变 → null
  ```
- `tests/note-section-reorder.test.mjs` — node:test + jiti，边界见 Validation。
- `src/views/ioto-task/task-view-section-drag.ts` — 视图编排：
  - `buildSectionDragController(view): TaskSectionDrag`（构造注入回调）；
  - `attachSectionDragHandle(handleEl, sectionEl, scrollEl, {onReorder})`（手势引擎：阈值/长按/ghost/命中/指示线/边缘自动滚/Esc）；
  - `commitSectionReorder(view, from, target, position)`：`flushInlineEdits()` → `exitZoom`/`cancelPendingDelete` 守卫 → 以 `view.data` 调纯函数 → `commitBlockRange` → conflict 走 `reloadFromVault`（同 swap）→ `applyOutcome` → `remapTrackedLines(view, result.mapLine)`（折叠 Set 重建 + selectedLine 迁移）→ `renderNote`。

### 修改

- `src/tasks-center/note-sections.ts`：导出内部共享 helper `collectRootSections(sections): NoteSection[]`（栈算法收敛为一份）；现有私有的 `resolveTopLevelHeadingLevel` 改为基于它（纯重构，行为不变）。
- `src/tasks-center/note-structure.ts`：barrel 导出 `reorderTopLevelSections` + `SectionReorderResult` 类型。
- `src/views/ioto-task/render-note-types.ts`（叶子类型模块）：新增
  ```ts
  export interface TaskSectionDrag {
    /** 渲染层建好 grip 按钮后调用；手势模块自行接管指针与落点提交 */
    attachHandle(handleEl: HTMLElement, sectionEl: HTMLElement, scrollEl: HTMLElement): void;
  }
  ```
- `src/views/ioto-task/render-sections.ts`：`RenderSectionOptions` 增加可选 `sectionDrag?: TaskSectionDrag`；`renderSectionHeader` 在 `editing.enabled && sectionDrag` 时于 actions 区首位建 grip 按钮（`grip-vertical`，`type=button`，aria-label 走 i18n），调用 `sectionDrag.attachHandle(...)`。
- `src/views/ioto-task/render-note.ts`：`RenderTaskNoteOptions` 增加可选 `sectionDrag?`，roots 循环透传给 `renderSection`。
- `src/views/ioto-task/task-view-render.ts`：`renderTaskNote({...})` 注入
  `sectionDrag: view.supportsInlineEdit() && !view.filters.onlyTaskBlocks ? buildSectionDragController(view) : undefined`。
- `styles.css`：grip 按钮（与 `.ioto-task-view__section-edit-btn` 同尺寸/对齐，默认 muted、hover normal）；`.is-dragging`（源块 opacity .35）；`.is-drop-before/.is-drop-after` 在 header 顶/底边画 2px `var(--interactive-accent)` 指示线；`.ioto-task-view__section-drag-ghost`（复用 tasks-center ghost 视觉口径：浮层、阴影、最大宽度）；编辑态/放大态隐藏手柄（`.is-editing …`、`:has(.is-zoomed) …`）；`.is-phone` 手柄 padding 6px；尊重 `prefers-reduced-motion`。
- `src/lang/locale/{en,zh-cn,zh-tw}.ts`：各加 1 key（locale-key-alignment 测试强制同步）。
- `scripts/check-view-writes.mjs`：WHITELIST 登记
  `task-view-section-drag.ts :: selectedLine` 与 `task-view-section-drag.ts :: collapsedSections`（理由：拖拽提交后的**行号重映射状态迁移点**，与 `task-view-filters.ts` 同款登记）。

### 新增 i18n key

| key | en | zh-cn | zh-tw |
|---|---|---|---|
| `view.iotoTaskView.sectionDragHandle` | `Drag to reorder section` | `拖动以重新排序章节` | `拖動以重新排序章節` |

## 纯函数重排算法（实现锁定，测试据此）

1. `lines = content.split('\n')`；`roots = collectRootSections(parseSections(content)).filter(level>0)`；空 → `null`。校验 `fromStartLine`/`targetStartLine` 都是某 root 的 `startLine`。
2. 每块：`body = lines.slice(start,end+1)` 剥掉尾部 `trim()===''` 的行；`prefix = lines.slice(0, roots[0].startLine)`（frontmatter+引导区，**原样**）；记录全文末尾连续空串数 `eofBlanks`。
3. 新顺序：从 roots 序列移除 from，按 `position` 把 from 插到 target 前/后得 `newOrder`；与原序列逐位相同 → `null`（no-op）。
4. 重组 `out`：`[...prefix]` → 若 prefix 非空且末行非空白补 1 个 `''` → 依次拼各块 body，块间 1 个 `''` → 末尾补回 `eofBlanks` 个 `''`（恢复结尾换行形态）。
5. `startLine = roots[0].startLine`，`endLine = lines.length-1`，`originalLines = lines.slice(startLine)`，`nextLines = out.slice(startLine)`（prefix 不动，切片对齐）。
6. `mapLine`：`< startLine` 恒等；逐块记录 body 内行偏移映射（旧 start+i → 新 start+i）；被剥掉的块尾空行 → `null`；末尾补回的空行无旧行。

## Implementation Steps

1. `collectRootSections` 收敛 + `appendSectionHeading` 改用它（纯重构，跑既有测试兜底）。
2. `note-section-reorder.ts` 纯函数 + barrel 导出。
3. `tests/note-section-reorder.test.mjs`（先写，见 Validation 用例清单）。
4. `task-view-section-drag.ts`：手势引擎（不接 view 先可独立思考的纯 DOM 部分）+ 提交编排 + `remapTrackedLines`（折叠 key 解析沿用 `shiftTrackedLines` 的「只 split 前两个冒号」法，标题可含 `:`）。
5. 叶子类型 + render-sections/render-note/task-view-render 接线。
6. styles.css 全套视觉（含 glass/modern/simple 主题只复用既有按钮变量，不做主题特化；移动端规则）。
7. 三语 key + check-view-writes 白单登记。
8. 全量验证。

## Dependencies and Considerations

- 无新依赖；全部复用 `commitBlockRange` / `applyOutcome` / `renderNote` / Notice 既有链路；Obsidian 原生撤销自动可用（单次原子写）。
- 子模块只经 `TaskViewHost` 契约 + 叶子类型 `TaskSectionDrag` 通信，不引入宿主值类型，守住 `import type` 与 dep-cruiser 双门禁；状态直写登记白名单。
- 拖拽手势状态是模块闭包瞬态（随每次 render 的 DOM 生灭），**不进 view 字段**，无需 check-view-writes 之外的字段设计。
- 冲突处理与 `swapSelectedTask` 一致：`commitBlockRange` 返回 conflict → Notice + `reloadFromVault` + renderNote。
- 折叠态可拖（整块含折叠体一起搬）；落点横线画在 header 上下，折叠/展开都可见。
- 拖动手柄与折叠 chevron、pencil/x 各自独立按钮，从手柄起拖不会误触折叠；阈值内的点击不进拖拽（手柄本身无 click 行为）。
- 主题（glass/modern/simple）下 header 的 sticky/背景由既有 CSS 负责，ghost 与指示线只用核心变量（`--interactive-accent`、`--background-modifier-message` 一类），不写死颜色。
- 边缘自动滚动仅在拖拽 rAF 循环内，pointerup/cancel 即停；`prefers-reduced-motion` 下去掉 ghost 跟手过渡（功能保留）。

## Validation

### 自动化

- 新增 `tests/note-section-reorder.test.mjs`，至少覆盖：
  1. 两块：`#A` 拖到 `#B` 后 → 顺序 BA、块间恰好一个空行；
  2. 三块中间块移到最前 / 最后；
  3. no-op：拖到自身等价槽位（前/后两种描述）→ `null`；
  4. 无标题块（空文件 / 仅引导区）→ `null`；
  5. 嵌套标题（`#A / ##A1`）整块随父搬运、块内字节不变；
  6. 块间多空行被规范化为 1 个；块内（列表/代码块中的空行）不变；
  7. frontmatter + 引导区 prefix 原样；
  8. 文件以换行结尾（`eofBlanks=1`）形态保留；
  9. `mapLine`：移动块内行随块迁移、静止块行号正确、被剥尾空行 → null、折叠 key 模拟重映射；
  10. `originalLines`/`nextLines` 与 startLine 切片严格对齐（可直接喂 commitBlockRange）。
- `npm test`（含 locale-key-alignment）/ `npm run lint` / `npm run dep:check` / `npm run build` 全绿；`node scripts/check-view-writes.mjs` 无未登记直写。

### 手动（桌面 + 移动端）

1. 鼠标手柄拖移：源块半透明 + 目标横线 + ghost 跟手；松手后顺序落盘、`Cmd/Ctrl+Z` 可撤销；
2. 触摸：普通滑动仍滚列表；长按手柄再拖才排序；
3. 折叠中的块可拖、可作为落点；展开态跨长距离 + 边缘自动滚动；
4. 「只显示任务」开启 → 手柄消失；关闭恢复；只读文件无手柄；
5. Section 整块编辑态、卡片放大态无手柄；
6. 折叠态记忆在排序后仍正确挂在对应块上（不串行）；选中行在移动块内时跟随迁移。

## Risks

- **触摸拖拽与纵向滚动冲突**：严格复用 touch-gesture 的「先长按后移动」双阈值；未长按的 move 立即 `scrollAborted` 且不捕获指针，交还原生滚动。
- **拖拽中外部写入**：提交走 `commitBlockRange` 的「startLine 序列校验 + 全文搜索兜底 + conflict 分支」，与任务互换同等级安全；拖拽期间不持有内容快照做乐观更新。
- **重绘打断手势**：拖拽全程不写盘不重绘；唯一重绘在松手提交之后（DOM 已重建、监听自然失效，先清完所有拖拽类与 ghost 再提交）。
- **sticky header 上的指示线定位**：指示线用 header 内 `::before/::after` 的绝对定位 2px 条（相对 section 坐标），不受 sticky 位移影响；ghost 挂 `body` 用 `position: fixed`，避免被 sticky/overflow 容器裁切。

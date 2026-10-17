# Task View 任务卡片拖拽排序（含跨章节移动）实现计划

> 日期：2026-10-17
> 参考先例：`task-view-section-drag-reorder_plan.md`（章节拖拽，已上线）——本方案在交互手势、模块分层、提交/重映射/动画链路上全面对齐该先例。

## 一、需求与研究结论

### 需求
在 Task View（`IOTOTaskView`，单篇 Markdown 笔记视图）中：

1. 拖拽任务卡片对任务进行**排序**（含父子层级，整块子树一起移动）；
2. 支持把任务从所在章节**拖到其他章节**。

### 现有实现现状（已确认）

- **章节拖拽已存在**：`src/views/ioto-task/task-view-section-drag.ts`（view 层手势）+ `src/tasks-center/note-section-reorder.ts`（纯函数），在每张卡片**所属章节**的 header 上挂 grip，仅排序标题、不移动正文。本方案复用其全套手势骨架（桌面 pointer / 移动端长按 400ms·8px 阈值 / 48px 悬浮 / 14px 命中中线 / 12px 指示线 / 边缘自动滚动 / Esc 取消）。
- **任务交换已存在**：`note-task-swap.ts` 的 `taskBlockRange()` 已实现「任务块 = 本行 + 更深层连续子任务 + 末节点续行」的行范围口径；键盘 Alt+↑/↓ 的 `swapSelectedTask()` 只能在**同章节同父的兄弟项**间交换，不支持跨章节、不改变层级。
- **卡片渲染**：`render-checklist-card.ts` 的 `renderChecklistGroup()` 生成 `<li class="ioto-task-view__card" data-line data-indent data-task-key data-task>`，内含 checkbox + 正文 + 续行 + `.card-actions` 底栏。底栏由 `refreshCardActions()`（task-view-inline-edit.ts）整体重建——**拖拽手柄必须挂在 `.card-actions` 之外**，否则刷新即丢。
- **章节结构**：`parseSections()` 给出每个章节（含引导区 level 0）的 `startLine/endLine`；`parseChecklistItemsInRange()` 可查章节内任务。章节可嵌套，渲染时只渲染 roots，但卡片的 `data-indent` 携带真实层级。
- **提交原语**：`commit-task-line.ts` 的 `commitBlockRange({ file, startLine, endLine, originalLines, nextLines, mapLine })` → `vault.process` 原子写回 + 冲突合并，是行块移动的统一入口。
- **过滤态**：`onlyTaskBlocks`（隐藏无任务章节）、`onlyPending`（隐藏完成卡）、`recentOnly`（只留最近 N 张顶级卡）、搜索关键词（隐藏不匹配卡）都会让部分卡片不渲染——隐藏卡片会让落点行空间出现歧义，**这些状态下必须禁用卡片拖拽**（章节拖拽只 gate 了 onlyTaskBlocks，卡片拖拽 gate 更严）。
- Host 契约 `TaskViewHost` 已具备本方案所需全部成员（`file/data/supportsInlineEdit/flushInlineEdits/exitZoom/cancelPendingDelete/zoomLine/app/applyOutcome/reloadFromVault/renderNote/selectedLine/collapsedSections`），**无需改 host、无需 barrel 薄委托**（控制器在 `task-view-render.ts` 构建，与 section drag 一致）。
- 白名单脚本 `scripts/check-view-writes.mjs` 需登记新模块对 `selectedLine`、`collapsedSections` 的直写。

## 二、交互设计

### 2.1 拖拽手柄

- 每张卡片**视觉最左缘**新增一个纯图标 grip（`grip-vertical`，无文字标签，对齐用户 UI 偏好），与章节 header grip 同款静音配色/2px 内边距/hover 加深；手机端命中区放大到 ≥36px。
- 用 CSS `order: -1` 置于卡片 flex 行首（卡片现有视觉序由 `order` 控制：正文 0 → checkbox 1），不依赖 DOM 顺序。
- 手柄是卡片**子元素但在 `.card-actions` 之外**：`refreshCardActions()` 重建底栏时不受影响。
- 点击手柄不触发选中卡片：手柄自身 `click` 阻止冒泡，并在卡片 click 委托中加 `closest('.ioto-task-view__card-drag-handle')` 早退双保险。

### 2.2 拖拽语义

- 拖动单位 = **完整任务块**（任务行 + 整块子树 + 续行），与 `taskBlockRange` 口径一致。
- 落点采用「成为目标的同级兄弟」模型：
  - **落在卡片上半部** → 插到目标卡片**正前方**；**下半部** → 插到目标块（含其子树）**正后方**；
  - 移动后整块按目标卡片的 indent **整体重排缩进**（delta 相同，子树相对层级不变）——这天然支持同章节重排、跨章节移动、以及跨层级挂载（拖成别人的子任务）。
- 章节级落点（保证空章节/折叠章节也能接收）：
  - 命中**章节 header** → 落到该章节**第一个任务之前**；
  - 命中**章节正文空白区**（无卡片处、空态）→ 落到该章节**最后一个任务之后**；
  - 命中滚动容器内其余空白（如最底部、「添加章节」按钮附近）→ 落到**全文最后一个任务之后**。
- 指示线：卡片落点在卡片上/下缘显示 2px 强调色横线；章节落点在 header 上缘 / body 下缘显示同款横线。
- 源卡拖拽中半透明 + `scrollEl.is-card-dragging`；复用章节拖拽的浮动 ghost（显示任务正文，截断 1 行）。

### 2.3 禁用条件（任一满足即不挂手柄/不构建控制器）

- `!supportsInlineEdit`（外部编辑写回窗口期）；
- `onlyTaskBlocks || onlyPending || recentOnly`（卡片集合不完整）；
- 搜索关键词非空（卡片被过滤）；
- 有卡处于 zoom 放大态（`zoomLine !== null`）时不开始新手势（grip 同步 CSS 隐藏）。

## 三、领域纯函数：`src/tasks-center/note-task-move.ts`（新建）

零 DOM / 零 obsidian，可单测。复用 `parseChecklistItems`、`taskBlockRange`、`splitTaskLine`/`composeTaskLine`/`indentLevelOf`、`parseSections`、`parseChecklistItemsInRange`。

```ts
export type TaskDropPosition = 'before' | 'after';

export type TaskDropTarget =
  | { kind: 'task'; line: number; position: TaskDropPosition }
  | { kind: 'section'; sectionStartLine: number; position: 'start' | 'end' };

export interface TaskMoveResult {
  startLine: number;            // 提交范围（0 基，闭区间）
  endLine: number;
  originalLines: string[];
  nextLines: string[];
  mapLine: (line: number | null) => number | null;
  movedNewStartLine: number;    // 被拖块新的首行（供选中态跟随）
}

export function moveTaskBlock(
  content: string,
  fromLine: number,
  target: TaskDropTarget,
): TaskMoveResult | null;   // 非法/无变化/成环 → null
```

### 算法要点

1. `items = parseChecklistItems(content, { includeEmpty: true })`（全文升序），定位 `from` 项；`taskBlockRange(items, fromIdx)` 得源块 `[srcStart, srcEnd]`。
2. 解析落点为「锚点行 + 目标层级」：
   - `task` 目标：`after` 锚点 = `taskBlockRange(target).end` 之后；目标层级 = 目标卡 indent；
   - `section-start`：锚点 = 该 section 内首个任务项之前（无任务则锚点 = 标题行后一行），层级 = 首个任务 indent，无任务时为 0；
   - `section-end`：锚点 = 末个任务块之后，层级 = 末任务 indent，无任务时为 0，锚点为标题行后一行（正文为空时）或 sectionEnd+1。
3. **成环保护**：目标块落在源块自身子树范围内（含源自身的无变化 before/after）→ 返回 `null`。
4. 先在原行数组上算出「删除缝」与「插入缝」，按标准 splice 位移换算（对齐 note-section-reorder 的缝计算）。
5. **整块重缩进**：`delta = targetLevel - fromLevel`：
   - 任务行：按 `indentLevelOf + delta`（clamp ≥0）走 `splitTaskLine/composeTaskLine`，tab 规整为空格（沿用 `setTaskIndent` 已知取舍）；
   - 续行/非任务行：行首空白按列数平移 `delta*2`（tab 按 2 列折算）；由于块内任何行缩进都 ≥ 源任务行，dedent 到 0 不会吃掉正文。
6. **空行规范化**（只影响两缝局部）：
   - 删除缝：把因删除而相连的 ≥2 连续空行收敛为 1；两侧均非空则 0 空行（任务-任务、标题-任务紧邻均合法）；
   - 插入缝：上邻为普通段落散文（非任务、非标题）时补 1 空行；下邻为非空散文行时补 1 空行（防止散文被当作 list item 的 lazy continuation 吞进任务）；任务/标题相邻不补。
7. 用对齐 section-reorder 的 token 源映射（`{source: 旧行号|null}`）产出整文件 `nextLines`，再收窄提交范围为「删除缝 … 插入缝」的最小并集；`mapLine` 基于源映射，未动行恒等映射，被删空行为 `null`。
8. CRLF 保护：只按 `\n` 切分，行尾 `\r` 随行走（与现有各 note-* 模块一致）；frontmatter 永不落在提交范围内（任务都在正文）。

### 已知边缘（在模块头注释中写明）

- 源任务与其深层子任务之间夹着标题行（`- a` / `## h` / `  - b`）时，按现有 `taskBlockRange` 口径标题会随块移动——与键盘 swap 现有行为一致，属 exotic 写法，接受。

### 出口登记

- `src/tasks-center/note-structure.ts` 增加 re-export。

## 四、View 层：`src/views/ioto-task/task-view-card-drag.ts`（新建）

镜像 `task-view-section-drag.ts` 的类与生命周期：

```ts
export interface TaskCardDrag {
  attachHandle(handleEl: HTMLElement, cardEl: HTMLElement, scrollEl: HTMLElement): void;
}
export function buildCardDragController(view: TaskViewHost): TaskCardDrag;
```

- `attachHandle`：桌面 `pointerdown`（鼠标左键）/ 移动端长按（touch 400ms、8px 取消阈值），`setPointerCapture`；从 `cardEl.dataset.line/indent/taskKey` 取源行号与正文（ghost 文案）。
- `evaluateDrop(x, y)`：`view.contentEl.elementFromPoint` →
  1. `closest('.ioto-task-view__card:not(.is-dragging)')` → `{kind:'task', line, position}`（中线 14px 判定）；
  2. 否则 `closest('.ioto-task-view__section')`：命中 `.ioto-task-view__section-header` → section-start，否则 section-end（读 `data-start-line/data-level`）；
  3. 否则在 scrollEl 盒内 → 全文末任务 after；盒外 → 无指示。
- 指示类：卡片 `.is-drop-before/.is-drop-after`；章节 `.is-section-drop-start/.is-section-drop-end`；每次重算先全清（复用 section drag 的清理函数思路，选择器并集）。
- 边缘自动滚动：复用 section drag 的 `requestEdgeScroll/stopEdgeScroll` 常量与节奏。
- `commit()`：
  1. `flushInlineEdits()` → `exitZoom(null)` → `cancelPendingDelete()`；
  2. `moveTaskBlock(view.data, fromLine, target)`；`null` 则 `renderNote(view.data)` 复原并 return；
  3. `commitBlockRange(...)` → 成功：`applyOutcome`，`selectedLine = result.mapLine(view.selectedLine)`，`collapsedSections` 经同款 `remapTrackedLines(mapLine)` 重映射（该 helper 在 note-section-reorder 中，抽到 `task-view-constants.ts` 或在新模块内复制一个小函数——倾向**导出复用**：从 note-section-reorder 导出 `remapTrackedLines`，section-drag 改为引用，零行为变化）；然后 `renderNote(result.nextLines.join('\n'))`；
  4. 冲突路径与 section drag 完全一致（`reloadFromVault` + Notice）。
- Esc 取消、长按期间 preventDefault 防选择菜单、`detach()` 全量卸载。

### 直写登记

`scripts/check-view-writes.mjs` 的允许表新增：
- `src/views/ioto-task/task-view-card-drag.ts :: selectedLine`
- `src/views/ioto-task/task-view-card-drag.ts :: collapsedSections`

## 五、渲染接线（4 个文件小改）

1. **`render-note-types.ts`**：`RenderNoteOptions`/章节渲染 options 增加可选 `cardDrag?: TaskCardDrag`（`import type`，遵守类型-only 分层约束）。
2. **`render-checklist-card.ts`**：`renderChecklistGroup` options 增加 `cardDrag?`、`scrollEl?`；当 `cardDrag` 存在且卡片非编辑态时，创建 grip 按钮（class `ioto-task-view__card-drag-handle`，`setIcon('grip-vertical')`，`aria-label`/`title` = 新 i18n key），作为 `cardEl` 子节点（`.card-actions` 之外），调用 `cardDrag.attachHandle(grip, cardEl, scrollEl)`；卡片 click 委托增加手柄早退。
3. **`render-sections.ts`**：`RenderSectionOptions` 与 `renderSectionBody` 透传 `cardDrag/scrollEl` 到每个 `renderChecklistGroup`（章节拖拽已有同型透传先例）。
4. **`render-note.ts`**：options 透传 `cardDrag`。
5. **`task-view-render.ts`**：按 §2.3 门禁构建控制器（读取 `view` 的过滤态 getter），随 `renderNote` 传入；不新建 interval/全局监听（监听全挂在手柄与 document 手势期，随重渲染自然回收，与 section drag 相同）。

## 六、样式（`styles.css` 单文件追加）

- `.ioto-task-view__card-drag-handle`：无背景按钮重置、`order:-1`、`align-self` 与 checkbox 同级居中（编辑态/放大态参考 checkbox 的 `flex-start` 覆盖）、静音色 hover 加深、`cursor: grab`、2px 内边距、focus-visible 环；`.is-phone` 命中区放大。
- `.ioto-task-view__card.is-dragging`：`opacity:.4`（与 section dragging 一致）。
- 卡片落点线：`.ioto-task-view__card.is-drop-before::before / .is-drop-after::after` 绝对定位 2px 强调色圆角线（卡片已是 `position:relative`）。
- 章节落点线：`.ioto-task-view__section.is-section-drop-start .ioto-task-view__section-header::before` 与 `.is-section-drop-end::after`（或 body 末缘）同款横线；复用现有 section 指示线变量。
- `.is-card-dragging` 期间 `user-select:none`、卡片 `cursor: grabbing`；卡片处于 `is-editing/is-zoomed` 或容器处于章节编辑态时隐藏手柄；`prefers-reduced-motion` 关闭过渡。
- ghost 复用 `.ioto-task-view__section-drag-ghost` 视觉，新增同构类 `.ioto-task-view__card-drag-ghost`（最大宽度按卡片宽度）。

## 七、i18n（三语必须同批）

在 `view.iotoTaskView.sectionDragHandle` 附近新增 1 个 key：

| key | en | zh-cn | zh-tw |
| --- | --- | --- | --- |
| `view.iotoTaskView.cardDragHandle` | Drag to reorder task | 拖拽以重新排序任务 | 拖曳以重新排序任務 |

文件：`src/lang/locale/en.ts`、`zh-cn.ts`、`zh-tw.ts`。locale-key-alignment 测试会强制校验。

## 八、测试：`tests/note-task-move.test.mjs`（新建，node:test + jiti）

1. 同章节相邻重排：`A B` → A 拖到 B 后 = `B A`；before/after 无变化 → `null`。
2. 子树随行：`A / A1 / B` → A 拖到 B 后 = `B / A / A1`，缩进不变。
3. 整块重缩进：二级子任务拖到另一个一级任务旁 → 整块变一级，孙任务层级相对不变。
4. 跨章节：`# S1` 下任务拖到 `# S2`；源章节标题与剩余任务完好，标题/任务间空行规范化。
5. 成环保护：父拖进自身子树 → `null`。
6. section-start / section-end：目标章节有任务时插到首前/末后；空章节（只有标题）时插在标题下一行、indent 0。
7. 散文隔离：任务块插到普通段落旁恰有 1 个空行；删除后多连空行收敛为 1。
8. 续行随父移动且随父重缩进。
9. `mapLine`：被拖块各行、未动行、被删空行（null）、后续章节标题位移全部正确；`movedNewStartLine` 正确。
10. CRLF 文件 `\r` 保留；frontmatter 不进提交范围。
11. 非法行号 / 目标不存在 → `null`。

## 九、实施顺序（依赖序）

1. `note-task-move.ts` 纯函数 + `note-structure.ts` 出口 + 测试（先红后绿）。
2. 从 `note-section-reorder.ts` 导出 `remapTrackedLines`，section-drag 改引用（纯重构，跑全测）。
3. `task-view-card-drag.ts` 手势控制器 + `check-view-writes.mjs` 登记。
4. 渲染接线（types → checklist-card → sections → render-note → render）。
5. `styles.css`。
6. 三语 i18n。
7. 全量验证。

## 十、验证

- `npm test`（含新测试与 locale 对齐测试，基线 698 全过）。
- `npm run lint`。
- `npm run dep:check`（类型-only 引用，无值级环）。
- `npm run build`（tsc strict + esbuild）。
- `node scripts/check-view-writes.mjs`（若可独立运行）+ GetDiagnostics 0 报错。
- 手工：桌面鼠标拖拽（同章节排序/跨章节/拖成子任务/空章节/折叠章节 header 落点/Esc/边缘滚动）；手机或 DevTools 触控模拟长按拖拽；各过滤态下手柄隐藏；拖拽后选中态、折叠态、写回结果正确。

## 十一、风险与应对

- **风险 1：隐藏卡片导致落点歧义** → 四类过滤/搜索态整体禁用（§2.3），与章节拖拽只 gate onlyTaskBlocks 相比更严格但可预测。
- **风险 2：跨章节时缩进/续行/散文产生非法 Markdown（lazy continuation 吞段落）** → 纯函数内空行规范化 + 第 7 组测试覆盖。
- **风险 3：手柄被 `refreshCardActions` 重建丢失** → 手柄挂在 `.card-actions` 外（§2.1）。
- **风险 4：与卡片点击选中、长按、编辑器手势冲突** → 手柄独立命中区 + click 早退双保险 + 8px/400ms 阈值与现有手势一致。
- **风险 5：成环（父拖进自己的子树）** → 纯函数成环保护返回 null，视图层静默复原。

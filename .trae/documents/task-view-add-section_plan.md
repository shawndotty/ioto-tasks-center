# Task View 底部「新增 Section」加号按钮 实现计划

## Repository Research

### Section 的渲染模型

- `renderTaskNote()`（[render-note.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/render-note.ts#L57-L88)）每次整树重建：`parseSections(content)` → `getTopLevelSections()` 取顶层 Section（roots）→ 逐个 `renderSection()` 挂进唯一的滚动容器 `.ioto-task-view__scroll`。
- 顶层 Section = Block；`NoteSection.level > 0` 为标题块（渲染折叠头），`level = 0` 为 frontmatter 后的引导区。嵌套标题留在父块体内（[render-sections.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/render-sections.ts#L118-L196)）。
- roots 循环结束后 scrollEl 即完成——**在循环之后向 scrollEl 追加一个按钮行**，天然满足「全视图只有一个、位于所有 section 最下方」。

### 「只显示任务」过滤

- 过滤开关 `TaskNoteFilters`（frontmatter 真源），`renderTaskNote` 内当 `filters.onlyTaskBlocks === true` 时把不含 checklist 的顶层 section 过滤掉（[render-note.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/render-note.ts#L71-L77)）。
- 加号按钮的显隐直接挂在同一条件上：**仅当 `!filters.onlyTaskBlocks` 时渲染**。`onlyPending` / `recentOnly` / 关键词搜索不影响它。

### Section 的写盘与编辑基建（可直接复用，无需新造写盘原语）

- 原子写：`app.vault.process`（`markAllTasksDone` 同款，回调内按最新 content 重算）+ 收尾 `view.applyOutcome({status:'ok', content})` → `view.renderNote()`。
- Section 整块内联编辑器已存在：`view.beginSectionEdit(startLine)`（[task-view-section-edit.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/ioto-task/task-view-section-edit.ts#L43-L167)），挂载后自动聚焦、失焦/Esc 提交，与「添加任务 → beginEdit」同构。新建后直接进入该态，用户可立刻把默认标题改名。
- 编辑态互斥与守卫：进入前 `view.flushInlineEdits()`（对齐 `markAllTasksDone`）；放大态由 `beginSectionEdit` 内部 `exitZoom()` 处理。
- 只读态：所有 section 编辑按钮只在 `editing.enabled`（= `supportsInlineEdit()`）时渲染。加号按钮沿用同一门禁。
- 视觉隔离已有 CSS 先例：section 编辑态用 `.ioto-task-view__scroll:has(...)` 隐藏其它 section（styles.css:2620）；放大态给其余块挂 `.is-zoom-hidden`。加号行需在这两种模式下一并隐藏（`:has` 纯 CSS 实现，与先例同口径）。

### 标题层级如何取

- 「跟当前其他 section 同级」= 取**最后一个顶层标题块**（roots 中 `level>0`）的标题级别；没有任何标题块（空笔记 / 仅引导区）时回退 `#`（1 级），与「添加任务」无 Section 时新建 `# 任务` 的惯例一致（[note-task-line.ts](file:///Users/Johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/note-task-line.ts#L260-L269)）。
- 落点恒在文末（最后一个 root 的 `endLine` 即文末）：末行非空 → 补一个空行再插标题；末行已是空行 → 复用，避免双空行；空文件 → 直接标题（与 `appendTaskBlock` 的三分支口径一致）。

## Files and Modules

- `src/tasks-center/note-sections.ts`：新增**纯函数** `appendSectionHeading(content, title)`，返回 `{ content, level, headingLine }`。零 DOM / 零 obsidian 依赖，可单测。
- `src/tasks-center/note-structure.ts`：barrel 导出新函数。
- `src/views/ioto-task/task-view-add-section.ts`：**新建**编排模块 `addSection(view)`（守卫 → 落盘在册编辑 → `vault.process` 追加 → applyOutcome → renderNote → beginSectionEdit）。
- `src/views/ioto-task/task-view-host.ts`：契约加 `addSection(): Promise<void>`。
- `src/views/iotoTaskView.ts`：import + 薄委托方法（与 `addTask` / `beginSectionEdit` 同位置同风格）。
- `src/views/ioto-task/render-note-types.ts`：`TaskNoteEditing` 增加可选 `addSection?(): void`（缺省 = 不渲染，与 `editSection` 同模式）。
- `src/views/ioto-task/task-view-render.ts`：`buildEditingController` 在 `inlineEdit` 分支挂 `addSection: () => void view.addSection()`。
- `src/views/ioto-task/render-sections.ts`：新增 `renderAddSectionEntry(scrollEl, onAddSection)`——图标按钮（`plus` 图标，无文字，aria-label 走 i18n）。
- `src/views/ioto-task/render-note.ts`：roots 循环后，当 `!filters.onlyTaskBlocks && editing.enabled && editing.addSection` 时调用上面的渲染函数（全视图仅一个）。
- `styles.css`：`.ioto-task-view__section-add` 行 + 按钮样式（低调：透明底、muted 色、默认半透明，hover 加深；左右/垂直 padding 与 section 体系一致）；section 编辑隔离态与卡片放大态下用 `:has()` 隐藏；`.is-phone` 触控态常显。
- `src/lang/locale/en.ts` / `zh-cn.ts` / `zh-tw.ts`：各加 2 个 key（locale-key-alignment 测试强制三语同步）。
- `tests/add-section.test.mjs`：**新建**，覆盖纯函数全部边界。

## 新增 i18n key

| key | en | zh-cn | zh-tw |
|---|---|---|---|
| `view.iotoTaskView.addSection` | `Add section` | `新增章节` | `新增章節` |
| `view.iotoTaskView.newSectionTitle` | `New section` | `新建章节` | `新建章節` |

（中文沿用现有「章节/章節」措辞，见 `sectionToggle`。）

## Implementation Steps

1. **纯函数**：在 `note-sections.ts` 实现 `appendSectionHeading`：
   - `parseSections` + 顶层 root 栈算法（与 `getTopLevelSections` 同逻辑，domain 层不引视图模块）求最后一个 `level>0` root 的 level（无则 1）；
   - 拼 `${'#'.repeat(level)} ${title.trim()}`；
   - 空内容 → 仅标题；末行 trim 为空 → 直接追加；否则补一个空行；
   - 返回新 content、level、标题行 0 基行号。经 `note-structure.ts` barrel 导出。
2. **单测先行**：`tests/add-section.test.mjs`（node:test + jiti，沿用现有风格）：
   - 空文件 → `# New section`，headingLine=0，level=1；
   - 末行非空 → 恰好一个空行分隔；
   - 末行已是空串 → 不产生双空行；
   - 文档只有 `##` 级顶层块 → 新块为 `##`（level 2）；
   - `# A` 内含 `## B`（嵌套）→ 新块仍为 `#`（level 1，不跟随嵌套标题）；
   - 仅引导区（标题前正文）→ level 1；
   - headingLine 始终指向新标题行。
3. **编排模块** `task-view-add-section.ts`：
   - 守卫 `view.file` + `view.supportsInlineEdit()`（只读静默，同 addTask）；
   - `await view.flushInlineEdits()`；
   - `let result` 外层变量，`view.app.vault.process(file, (content) => { result = appendSectionHeading(content, t('view.iotoTaskView.newSectionTitle')); return result.content; })`（回调内按最新 content 重算，并发外部写入自洽）；
   - `view.applyOutcome({status:'ok', content: result.content})`；
   - `view.renderNote(view.data)`；
   - `await view.beginSectionEdit(result.headingLine)`（DOM 由 renderNote 同步产出 section 外壳；内部自动聚焦、失焦即提交改名）。
4. **接线**：host 契约加方法 → `iotoTaskView.ts` 薄委托 → `TaskNoteEditing.addSection?` → `buildEditingController` 的 inlineEdit 分支挂回调。
5. **渲染**：`render-sections.ts` 加 `renderAddSectionEntry`（`setIcon(btn, 'plus')`，`type=button`，aria-label/title 用 `view.iotoTaskView.addSection`，click 调回调）；`render-note.ts` 在 roots 循环后按门禁渲染一次。
6. **样式**：styles.css 在 section 样式区块（约 2496-2634 行附近）追加：
   - 行容器：`padding: 0 var(--ioto-tv-pad-x)`，与 section body 左缘对齐；
   - 按钮：透明底/无边框/`color: var(--text-muted)`/`opacity: .55`，hover → `opacity:1` + `color: var(--text-normal)`；尺寸与 `section-toggle`/`section-edit-btn` 一致（padding:2px、height:auto）；
   - 隐藏规则 A：`.ioto-task-view__scroll:has(> .ioto-task-view__section.is-editing) > .ioto-task-view__section-add { display:none; }`；
   - 隐藏规则 B：`.ioto-task-view__scroll:has(.ioto-task-view__card.is-zoomed) > .ioto-task-view__section-add { display:none; }`；
   - `.is-phone` 下默认 opacity 提到 1（无 hover 设备，沿用 section actions 触控口径）。
7. **i18n**：三语文件各加 2 key。

## Dependencies and Considerations

- 无新依赖；全部复用 `vault.process`、`applyOutcome`、`renderNote`、`beginSectionEdit` 既有链路。
- 子模块只经 `TaskViewHost` 契约访问 view（`import type`），不引入 `IOTOTaskView`，符合分层门禁；不直写 view 状态字段（写盘收口走 `applyOutcome`），无需登记 `check-view-writes.mjs`。
- 监听器挂在每次 render 新建的 scrollEl 内的按钮上，随 DOM 丢弃，无需 `register*`（与 section-toggle/edit 按钮同生命周期）。
- 新建后进入 section 编辑隔离态（只显示新节）是既有既定交互，用户改名失焦即落盘；Esc 同样提交（默认标题被原样保留也合法）。
- 用户偏好：无文字图标按钮、padding/垂直对齐与既有元素一致——样式按 section header 按钮同口径。
- 空笔记（无任何 section）时加号也显示，成为首个 section 的入口；这正是「无法新增 section」痛点的核心场景。

## Validation

- `npm test`（含新增 add-section 测试与 locale-key-alignment）。
- `npm run lint`。
- `npm run dep:check`（确认无值级环）。
- `npm run build`（tsc 严格模式 + esbuild）。
- 手动验证（桌面 + 移动口径 CSS）：
  1. 普通任务笔记底部出现一个低调加号；点击 → 文末新增同级标题 section 并立即进入标题编辑，可直接改名，失焦保存；
  2. 开启「只显示任务」→ 加号消失；关闭 → 恢复；
  3. section 整块编辑隔离态、卡片放大态下加号不可见；
  4. `#` 级 / `##` 级两种笔记分别新增，级别与既有顶层 section 一致；
  5. 只读（不支持内联编辑）场景无加号。

## Risks

- **vault.process 回调并发**：回调内基于最新 content 重算（而非用 view.data 预算），与 markAllTasksDone 同口径，规避外部同时写入错位。
- **renderNote 后立即 beginSectionEdit 取节点失败**：section 外壳是同步创建的（仅 Markdown 正文异步），与 `runLineAction` render→beginEdit 的既有顺序一致；若极端情况未命中，`beginSectionEdit` 自身会静默 return，新 section 已落盘，无数据风险。
- **末尾空行形态多样（多个空行 / 以换行结尾）**：只处理末行一种分隔，与 `appendTaskBlock` 行为保持一致，不额外归一化（避免改动既有内容）。

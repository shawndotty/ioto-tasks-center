# 任务搜索改为窗口居中偏上的浮层交互（Omnibar 风格）

## 概要

将任务中心的搜索交互从「锚定在搜索图标下方的小 popover」改为「整个 Obsidian 窗口居中偏上显示的搜索浮层」：

1. 点击任务列表头部的搜索按钮 → 搜索框在**整个窗口水平居中、垂直偏上**的位置弹出，其余区域被半透明遮罩压暗（dimming），搜索框高亮（聚焦光圈）。
2. 桌面端与移动端行为一致（基于 Obsidian `Modal`，天然支持移动端）。
3. 点击搜索框后面的**搜索按钮**（或按 Enter）→ 浮层立即消失，任务列表按关键词过滤显示结果。
4. 点击遮罩空白处或按 Escape → 取消（不应用输入），浮层关闭。

## 现状分析

当前搜索链路（已读代码确认）：

- 入口：[tasks-pane-renderer.ts](../../../src/views/tasks-center/tasks-pane-renderer.ts) 中任务面板头部的搜索图标按钮，点击调用 `view.toggleTaskSearchPopover(anchorEl)`。

- 控制器：[search-controller.ts](../../../src/views/tasks-center/search-controller.ts) 负责 open/close/apply/clear，并通过 `shouldFocusTaskSearchPopover` 标志在每次视图重渲染后重建 popover 并恢复焦点。

- UI：[task-search-popover.ts](../../../src/ui/task-search-popover.ts) `TaskSearchPopover` 是手工定位的 `position: fixed` 小浮层，锚定在按钮下方（`positionAtAnchor`），宽度约 420px，无遮罩、无压暗，体验差且移动端不友好。

- 视图持有：[iotoTasksCenterView.ts](../../../src/views/iotoTasksCenterView.ts) 中 `taskSearchPopover` / `isTaskSearchPopoverOpen` / `shouldFocusTaskSearchPopover` 字段，`onOpen` 构造、`onClose` 销毁。

- 渲染期重开：`renderTasksPane` 末尾在 `isTaskSearchPopoverOpen` 时用新 anchor 重新 `openTaskSearchPopover(...)`（因为 render 会清空 contentEl，popover 需重建）。

- 应用搜索后 popover 保持打开并重新聚焦；关闭后有关键词时头部显示 hint 胶囊（关键词 + X 清空）。

- 纯过滤逻辑在 [task-search.ts](../../../src/views/task-search.ts)（`filterTasksBySearchQuery`），有对应测试 `tests/task-search.test.mjs`，本次不动。

- 样式：styles.css 429-550 行有 `.ioto-tasks-center__task-search-popover`（旧定位）及可复用的控件样式（`__task-search-controls` / `__task-search-input` / `__task-search-clear-button` / `__task-search-button` 等）。其中 440 行 `.ioto-tasks-center__task-search` 为无引用的死规则。

- i18n：`view.search.*` 键（placeholder/button/run/clear/clearShort/toggle）三语言齐全，**无需新增键**。

## 方案设计

用 Obsidian 原生 `Modal`（项目内 `src/ui/` 已有多个 Modal 先例，如 [taskNameModal.ts](../../../src/ui/taskNameModal.ts)）替换手写 popover：

- `Modal` 自带：全屏 `.modal-container` + `.modal-bg` 半透明遮罩（满足"dimming 其他区域"）、Escape 关闭、点击遮罩关闭、移动端适配、z-index 层级管理。

- 垂直位置改为「居中偏上」：容器 `align-items: flex-start` + `.modal { margin-top: 25vh }` 覆盖默认垂直居中（CSS 常量，便于调整）。

- Modal 挂载在 `document.body`，与视图 `contentEl` 无关 → **视图重渲染不再需要重建搜索框**，可删除 `renderTasksPane` 中的重开逻辑和 `shouldFocusTaskSearchPopover` 标志（输入焦点天然保持）。

- 搜索框内部控件（输入框 + 清空 X + 搜索按钮）复用现有 DOM 结构与 CSS 类名，仅外壳换成 Modal。

## 具体改动

### 1. 新建 `src/ui/task-search-modal.ts`（替代 popover）

```ts
import { Modal } from 'obsidian';

export interface TaskSearchModalOptions {
	placeholder: string;
	value: string;
	canSearch: boolean;
	showClear: boolean;
	searchButtonText: string;
	searchButtonAriaLabel: string;
	clearButtonAriaLabel: string;
	clearButtonTitle: string;
	onChange: (value: string) => void;
	onApply: () => void;
	onClear: () => void;
	onClosed: () => void;   // Modal 关闭后回调（含 Escape/遮罩/编程关闭）
}

export class TaskSearchModal extends Modal {
	private options: TaskSearchModalOptions | null = null;

	openSearch(options: TaskSearchModalOptions): void {
		this.options = options;
		this.open();
	}

	onOpen(): void {
		// 读 this.options（为空则 close 并 return）
		// 1. this.containerEl.addClass('ioto-tasks-center__task-search-modal-container')
		//    this.modalEl.addClass('ioto-tasks-center__task-search-modal')
		//    this.modalEl.querySelector('.modal-close-button')?.remove(); // 移除 Modal 默认右上角 X，保持 omnibar 简洁
		// 2. contentEl 内构建（沿用现有类名）：
		//    .ioto-tasks-center__task-search-controls
		//      ├─ .ioto-tasks-center__task-search-input-wrapper
		//      │    ├─ input.ioto-tasks-center__task-search-input (type=search, placeholder, value, disabled=!canSearch)
		//      │    │     input 事件 → options.onChange(value) + 同步 X 按钮显隐（is-hidden）
		//      │    │     keydown Enter → preventDefault + options.onApply()
		//      │    └─ button.ioto-tasks-center__task-search-clear-button (初始按 showClear 显隐)
		//      │          click → 清空 input.value、隐藏自身、focus input、options.onClear()
		//      └─ button.ioto-tasks-center__task-search-button (搜索按钮, disabled=!canSearch)
		//             click → options.onApply()
		// 3. 聚焦：沿用旧 popover 的 requestAnimationFrame 模式 inputEl.focus() + inputEl.select()
	}

	onClose(): void {
		this.contentEl.empty();
		const options = this.options;
		this.options = null;
		options?.onClosed();
	}
}
```

要点：清空 X 的显隐由 Modal 内部根据输入值动态切换（旧 popover 靠每次重建由 `showClear` 决定，Modal 常驻后需自己管理）。

### 2. 删除 `src/ui/task-search-popover.ts`

整文件删除（无其他引用方，已用 rg 确认仅 4 个文件涉及，均在本次改动范围内）。

### 3. 重写 `src/views/tasks-center/search-controller.ts`

```ts
// canSearchTasks / shouldShowTaskSearchIcon 保持不变

export function toggleTaskSearchModal(view): void {
	if (view.isTaskSearchModalOpen) { closeTaskSearchModal(view); return; }
	openTaskSearchModal(view);
}

export function openTaskSearchModal(view): void {
	const modal = view.taskSearchModal;
	if (!modal || !shouldShowTaskSearchIcon(view)) return;
	view.isTaskSearchModalOpen = true;
	// 移除头部 hint 胶囊（沿用旧行为）：view.contentEl.querySelector('.ioto-tasks-center__task-search-hint')?.remove();
	modal.openSearch({
		// placeholder/value/canSearch/showClear/文案均打开时从 view 状态读取（与旧 openTaskSearchPopover 相同）
		onChange: (value) => { view.taskSearchInputValue = value; },
		onApply: () => { applyTaskSearchQuery(view); },
		onClear: () => { clearTaskSearch(view); },
		onClosed: () => { handleTaskSearchModalClosed(view); },
	});
}

export function closeTaskSearchModal(view): void {
	view.taskSearchModal?.close();
	view.isTaskSearchModalOpen = false;
}

function handleTaskSearchModalClosed(view): void {
	if (!view.isTaskSearchModalOpen) return;   // 防止视图关闭期重复 render
	view.isTaskSearchModalOpen = false;
	view.render();                              // 恢复头部 hint 胶囊等
}

export function applyTaskSearchQuery(view): void {
	view.taskSearchQuery = view.taskSearchInputValue;
	closeTaskSearchModal(view);   // 「点击搜索按钮 → 直接消失」；onClose → handleTaskSearchModalClosed → render 一次
}

export function clearTaskSearch(view): void {
	// 保持旧逻辑：清空 input + query 后 render；Modal 不关闭（Modal 自己已清空输入框并聚焦）
}
```

时序说明：`applyTaskSearchQuery` 先赋值 `taskSearchQuery` 再 close，`onClosed` 里的 `render()` 读到的已是新 query，全程只 render 一次。

### 4. 修改 `src/views/iotoTasksCenterView.ts`

- import：`TaskSearchPopover` → `TaskSearchModal`（来自 `../ui/task-search-modal`）。

- 字段：

  - `taskSearchPopover: TaskSearchPopover | null` → `taskSearchModal: TaskSearchModal | null`

  - `isTaskSearchPopoverOpen` → `isTaskSearchModalOpen`

  - **删除** `shouldFocusTaskSearchPopover`（Modal 常驻后不再需要重建聚焦）

- `onOpen()`：`this.taskSearchModal = new TaskSearchModal(this.app);`

- `onClose()`：先 `this.isTaskSearchModalOpen = false;`（让 onClosed 回调 no-op，避免关闭视图时多余 render），再 `this.taskSearchModal?.close(); this.taskSearchModal = null;`

- 方法重命名并简化签名（均委托 search-controller）：

  - `toggleTaskSearchPopover(anchorEl)` → `toggleTaskSearchModal()`

  - `openTaskSearchPopover(anchorEl, forceFocus)` → `openTaskSearchModal()`

  - `closeTaskSearchPopover()` → `closeTaskSearchModal()`

  - `applyTaskSearchQuery()` / `clearTaskSearch()` 名称不变

- `getState()` / `setState()` 不动（`isTaskSearch*Open` 本就是瞬态，不持久化）。

### 5. 修改 `src/views/tasks-center/tasks-pane-renderer.ts`

- 搜索按钮 click：`view.toggleTaskSearchPopover(anchorEl)` → `view.toggleTaskSearchModal()`（删除 `event.currentTarget` anchor 判断；`searchToggleButtonEl` 改为 `if (shouldShowSearchIcon)` 块内的 `const`）。

- hint 胶囊条件：`!view.isTaskSearchPopoverOpen && keyword` → `!view.isTaskSearchModalOpen && keyword`。

- else 分支：`view.closeTaskSearchPopover()` → `view.closeTaskSearchModal()`。

- **删除**末尾的重开块（Modal 挂在 body，重渲染不影响）：

  ```ts
  if (shouldShowSearchIcon && view.isTaskSearchPopoverOpen) {
      if (searchToggleButtonEl) { view.openTaskSearchPopover(searchToggleButtonEl, false); }
  }
  ```

### 6. 修改 `styles.css`

- 删除 `.ioto-tasks-center__task-search-popover`（429-438 行）和死规则 `.ioto-tasks-center__task-search`（440-442 行）。

- 原位新增（控件类 `__task-search-controls` / `-input` / `-clear-button` / `-button` 等全部保留复用）：

```css
.ioto-tasks-center__task-search-modal-container,
.is-phone .ioto-tasks-center__task-search-modal-container {
	align-items: flex-start;      /* 覆盖默认/移动端的垂直居中 */
	justify-content: center;
}

.ioto-tasks-center__task-search-modal,
.is-phone .ioto-tasks-center__task-search-modal {
	width: min(560px, calc(100vw - 32px));
	margin-top: 25vh;             /* 居中偏上，可调 */
	padding: 12px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 12px;
	background: var(--background-primary);
	box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
}

/* 聚焦时高亮搜索框 */
.ioto-tasks-center__task-search-modal:focus-within {
	border-color: var(--interactive-accent);
	box-shadow:
		0 0 0 2px color-mix(in srgb, var(--interactive-accent) 22%, transparent),
		0 12px 28px rgba(0, 0, 0, 0.18);
}
```

说明：压暗由 Obsidian 核心 `.modal-bg` 提供；`.is-phone` 前缀选择器防止 Obsidian 移动端对 `.modal-container` / `.modal` 的默认覆盖（插件样式后加载，同特异性下生效）。

### 7. 更新用户文档（各 1 行，保持描述与行为一致）

- `docs/USER_GUIDE.md` 124 行：`Search popover with focus, clear, and keyboard support` → `Centered search overlay with a dimmed backdrop, plus focus, clear, and keyboard support`

- `docs/USER_GUIDE.zh-CN.md` 129 行：`搜索使用独立 popover，支持聚焦、清空和键盘操作` → `搜索使用居中浮层并压暗其余区域，支持聚焦、清空和键盘操作`

- 两份文档 2.1.0 历史更新日志中的 popover 表述为历史记录，不改动。

## 假设与决策

1. **Enter 键 = 点击搜索按钮**：应用搜索并立即关闭浮层（键盘等价操作）。
2. **Escape / 点击遮罩 = 取消**：不应用当前输入，直接关闭（与旧 popover 的外点关闭行为一致）。
3. **清空 X**：清空输入与已应用的关键词、刷新列表，浮层保持打开继续输入（沿用旧行为）。
4. **不做输入即时过滤**：按用户要求，点击搜索按钮后才在任务列表生效。
5. 浮层宽度上限 560px、距顶 25vh —— CSS 常量，后续可微调。
6. i18n 复用现有 `view.search.*` 键，三语言文件零改动。
7. 不在本次做版本号 bump / 发布（用户未要求）。
8. 无新增单元测试：改动均为 UI 层（Modal/控制器），无新的纯逻辑；纯过滤逻辑 `task-search.ts` 未动，已有测试覆盖。

## 验证步骤

1. `npm test` —— 全部通过（现有 34 个测试文件不受影响）。
2. `npm run lint` —— 无新告警。
3. `npm run build` —— tsc 类型检查 + esbuild 通过。
4. 桌面端手工验证（vault 中启用插件，打开 Tasks center，选中含任务的项目）：

   - 点击搜索图标 → 浮层出现在窗口居中偏上位置，其余区域变暗，输入框自动聚焦。

   - 输入关键词 → 点击「搜索」→ 浮层立即消失，任务列表过滤生效，头部出现关键词 hint 胶囊。

   - 按 Enter → 同上（应用并关闭）。

   - 按 Escape / 点击遮罩 → 浮层关闭，列表不变。

   - 点击 X → 输入与查询清空，浮层保持打开且聚焦，列表恢复。

   - 搜索激活时打开任务 → 预览定位到首个匹配（既有逻辑，回归确认）。
5. 移动端（或窄面板）验证同样流程；确认软键盘弹出时浮层不被遮挡。
6. 边界：浮层打开时切换项目/触发 vault 事件导致重渲染 → 浮层不消失、焦点不丢失；搜索图标隐藏（如项目未选）时浮层被关闭。


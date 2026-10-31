import { t } from '../../lang/helpter';
import {
	buildSiblingTaskLine,
	setTaskIndent,
} from '../../tasks-center/note-structure';
import {
	buildMultiRemovalEdit,
	remapLineAfterMultiDelete,
} from '../../tasks-center/note-task-multi-delete';
import { ConfirmModal } from '../../ui/confirmModal';
import { commitBlockRange, commitTaskLineAction } from './commit-task-line';
import {
	collectCardLines,
	pickLineAfterDelete,
} from './card-navigation';
import type { TaskViewHost } from './task-view-host';
import { isCardEditing } from './task-view-editing-state';
import {
	clearMultiSelection,
	resolveMultiMembers,
} from './task-view-multi-selection';
import { isCardInZoomedSection } from './task-view-section-zoom';
import type { ModEnterHost } from './select-mode-scope';

/**
 * 选中一张卡片（`idle|selected|editing → selected`）。
 *
 * 正编辑**其它**卡片时先提交（mousedown 的 blur 已经先跑过一次，这里是兜底，
 * 例如方向键移动或 `Option+I` 面板关闭后重新选中）。已在本卡编辑态则忽略。
 */
export function select(view: TaskViewHost, line: number): void {
	// 换选中即离开 pending 语境：先撤遮罩（幂等，焦点交给随后的 applySelection）
	view.cancelPendingDelete(false);
	// 🔴 只在**卡片级**编辑态走「先提交再改选」：续行 / Section 编辑态的换选语义
	// 未在批次 0 定义，保持现状（直接 applySelection）。
	if (isCardEditing(view.editingKind) && view.editingLine !== line) {
		void view.commitEdit().then(() => applySelection(view, line));
		return;
	}
	if (isCardEditing(view.editingKind) && view.editingLine === line) {
		return;
	}
	applySelection(view, line);
}

/**
 * 增量切选中：**绝不整树重绘**——重绘会让 `scrollTop` 归零，还会吞掉连续按键
 * （[[Research-20261003-091331]] §3.1、[[Plan-20261003-094145]] §5.3）。
 *
 * 方案 A（[[Discuss-20261008-173935]]）：当 `line === zoomLine` 时只更新内部
 * `selectedLine`、**不加** `.is-selected`（放大卡恒编辑，选中语义整体停用）。
 */
export function applySelection(view: TaskViewHost, line: number): void {
	// 任何改选中的入口都先撤遮罩（坑 C / Q2）；焦点交给下面的 cardEl.focus
	view.cancelPendingDelete(false);
	// 多选收窄（[[Plan-20261101-054951]] §四.3c / C2）：必须放在最前面——任何进编辑
	// 的入口都走这里，于是「不支持批量编辑」免费成立；同时保证下面的 queryCard
	// 判定不被成员类干扰。
	clearMultiSelection(view);
	// 防御：「只看本节」态下选中落到聚焦节之外 → 先退出聚焦，否则加类也看不见
	// （[[Research-20261019-131228]] §4.6）。
	if (
		view.sectionZoomLine !== null &&
		!isCardInZoomedSection(view, view.queryCard(line))
	) {
		view.exitSectionZoom();
	}
	const prev = view.selectedLine;
	if (prev !== null && prev !== line) {
		view.queryCard( prev)?.removeClass('is-selected');
	}
	view.selectedLine = line;

	const cardEl = view.queryCard( line);
	if (!cardEl) {
		// 行号已漂移 / 卡片被折叠：交由后续整树渲染兜底
		view.selectedLine = null;
		view.refreshDeleteButtonVisibility();
		return;
	}

	// 方案 A：放大态恒编辑、不出现选中态——内部 `selectedLine` 保留，但跳过加类
	if (view.zoomLine !== line) {
		cardEl.addClass('is-selected');
	}
	cardEl.focus({ preventScroll: true });
	view.scrollCardIntoView(cardEl);
	view.refreshDeleteButtonVisibility();
}

/**
 * blur 提交后的「焦点还原」：与 Esc 出口（onEditorEscape）对称
 * （[[Discuss-20261005-175835]] §四·A，[[Plan-20261005-180341]]）。
 *
 * 只在「焦点落空」时拉回，避免和用户主动跳走（点另一张卡 / 点工具栏 /
 * 切侧栏 / 打开链接）打架：
 *  - 选中没在途中被挪走（`selectedLine` 仍是本行）——防与点另一张卡的竞态；
 *  - 卡片仍在（未被折叠 / 重绘挪走）；
 *  - `activeElement` 既不在任何卡片内，也**确实掉空**（body / documentElement / null）。
 *
 * 用 `applySelection` 而不是手写 addClass+focus，是为了顺带清掉上一张卡的
 * 残留选中类，并与 Esc 路径共用同一套语义。
 */
export function restoreSelectionFocusAfterBlurCommit(
	view: TaskViewHost,
	line: number,
): void {
	if (view.selectedLine !== line) {
		return;
	}
	if (!view.queryCard( line)) {
		return;
	}

	const doc = activeDocument;
	const activeEl = doc.activeElement;
	const orphaned =
		activeEl === null ||
		activeEl === doc.body ||
		activeEl === doc.documentElement;
	if (!orphaned) {
		return;
	}

	applySelection(view, line);
}

/**
 * 选择态下 `Delete` / `Backspace`：删当前行**及其下连续续行**（`Shift+Enter` 正文，
 * 卡片里显示几行就删几行），**不级联嵌套子行**；
 * 选择落到「原位置的下一张，否则上一张」。
 */
export async function deleteSelected(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	// 坑 1：被删行正是放大行时，先退放大并回收编辑器，再走删除。
	// 否则 renderNote → restoreZoom() 用旧行号 queryCard 会命中「下一张卡」→ 放大错卡。
	if (view.zoomLine === line) {
		view.exitZoom();
		view.destroyActiveEditor(); // 内含 autosave.cancel()（:2274），避免随后 autosave 写已删行
		view.editingLine = null;
		view.editingOriginalLine = '';
	}

	// 删除前先取 DOM 顺序：删除会让后续卡片的 data-line 整体前移
	const order = collectCardLines(view.contentEl);
	const removedCount = 1 + view.countContinuationLines( line); // 任务行 + 续行
	const nextLine = pickLineAfterDelete(order, line, removedCount);

	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine: view.lineAt( line),
		transform: () => '',
		swallowContinuations: true, // 与渲染层同口径
	});
	// 🔴 红线：data / lastLoadedText 必须同步
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		// 罕见路径，允许整树重建
		view.selectedLine = line;
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		// unchanged：没删掉任何行，选择不动
		return;
	}

	// 结构性变更 → 整树重建（不跳顶由 ioto-task-scroll.ts 兜底）。
	// 单任务删除：开启「只显示最近任务」时补进出场动画（[[Plan-20261005-150106]] §2.5.2）。
	view.selectedLine = nextLine;
	view.renderNote(view.data, { animateRecentSwap: true });
	if (nextLine !== null) {
		view.queryCard( nextLine)?.focus({ preventScroll: true });
	}
}

/**
 * 多选批量删除（[[Plan-20261101-054951]] §四.步骤 6）：统一 `ConfirmModal` +
 * **一次**原子 `commitBlockRange`，删完把锚点映射到新行号并重绘。
 *
 * 与 `deleteSelected` 的三处刻意差异：
 * 1. 按**块**删（任务行 + 整棵子树 + 末节点续行），不沿用「只删任务行 + 续行」
 *    ——否则批量删完会留下一堆缩进孤儿行；
 * 2. 一次写（N 次单行写 = N 次 modify 事件 → N 次重绘竞争，行号迁移还会 O(N²)）；
 * 3. 不逐条 remap 成员：这批成员本来就全没了，`clearMultiSelection` 即可。
 *
 * 不做撤销（`vault.process` 不进编辑器 undo 栈，与整节删除同口径）。
 */
export async function deleteMultiSelected(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默
	}

	await view.flushInlineEdits(); // 在册编辑器先落盘
	view.cancelPendingDelete(false); // T4：多选态不并存待删除遮罩

	const members = resolveMultiMembers(
		view.selectedLine,
		view.multiAnchor,
		view.multiLines,
	);
	const lines = [
		...members,
		...(view.selectedLine === null ? [] : [view.selectedLine]),
	];
	if (lines.length < 2) {
		return; // 单选走既有卡内遮罩链路
	}

	const confirmed = await new ConfirmModal(
		view.app,
		t('modal.deleteTasks.title'),
		{
			descriptionText: t('modal.deleteTasks.desc', [String(lines.length)]),
			confirmButtonText: t('modal.deleteTasks.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	if (!confirmed) {
		return;
	}

	// 弹窗抢焦点会触发 blur 提交（同 deleteSection 口径），再幂等收口一次。
	await view.flushInlineEdits();

	const removal = buildMultiRemovalEdit(view.data, lines);
	if (!removal) {
		// 内容已漂移（块已不存在）：静默复原
		view.renderNote(view.data);
		return;
	}

	// 结构性变更前先退出两类聚焦（`startLine` 身份会失效，同 deleteSection 口径）。
	if (view.sectionZoomLine !== null) {
		view.exitSectionZoom();
	}
	if (view.zoomLine !== null) {
		view.exitZoom();
	}

	const outcome = await commitBlockRange(view.app, file, {
		...removal.edit,
		nextText: '', // `nextLines` 通道优先，这里只为满足选项形状
	});
	// 🔴 红线：data / lastLoadedText 必须同步
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		clearMultiSelection(view);
		await view.reloadFromVault();
		return;
	}
	if (outcome.status !== 'ok') {
		// unchanged：一行没删，选中态原样保留
		view.renderNote(view.data);
		return;
	}

	// 🔴 先 remap 再重绘：`renderNote` 末尾的 `syncSelectionClass` 会按
	// `selectedLine` 加类，此刻若还是删除**前**的行号，就会画到新内容的同一行号上
	// —— 即一张毫不相干的卡（[[Plan-20261101-054951]] §三.口径 3）。
	view.selectedLine =
		view.selectedLine === null
			? null
			: remapLineAfterMultiDelete(removal, view.selectedLine);
	clearMultiSelection(view); // 成员全被删掉 ⇒ 集合必然清空
	view.renderNote(view.data);

	// 锚点被删（或被接缝规范化吃掉）→ 退到「删除窗口新坐标处最近的可见卡」。
	const target =
		view.selectedLine ??
		pickEdgeAtOrAfter(collectCardLines(view.contentEl), removal.edit.startLine);
	if (target !== null) {
		view.applySelection(target);
	} else {
		view.refreshDeleteButtonVisibility();
	}
}

/** 删除后重定位：第一个 ≥ start 的可见卡，否则最后一张。 */
function pickEdgeAtOrAfter(order: readonly number[], start: number): number | null {
	return order.find((line) => line >= start) ?? order[order.length - 1] ?? null;
}

/**
 * 选择态 `Tab` / `Shift+Tab`：对选中行做 ±1 级缩进，写回后**保持选中**。
 * 与 `deleteSelected` 同构（同一 `commitTaskLineAction` + 整树重建 + 回填焦点），
 * 差别只在：缩进**不改行数**，故行号不漂移，重建后仍聚焦同一行；`setTaskIndent`
 * 负责 clamp 到 `[0, 8]` 并规整为「每级 2 空格」。到边界时 transform 返回同一行，
 * `commitTaskLineAction` 记为 `unchanged`，无写入、无重绘（幂等）。
 */
export async function indentSelected(
	view: TaskViewHost,
	line: number,
	delta: number,
): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine: view.lineAt( line),
		transform: (raw) => setTaskIndent(raw, delta),
	});
	// 🔴 红线：data / lastLoadedText 必须同步
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		// 罕见路径，允许整树重建
		view.selectedLine = line;
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		// unchanged：已到缩进边界（0 级 / 8 级），选中不动
		return;
	}

	// 缩进改变卡片 `data-indent`，需重建 DOM 才能刷新 `margin-inline-start`
	// （styles.css 的 [data-indent] 规则）；行数不变 → 行号不漂移，就地回填选中。
	view.renderNote(view.data);
	view.queryCard( line)?.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ *
 * 选择态 → 待删除确认瞬态（[[Plan-20261005-141853]] §三/§四）
 * ------------------------------------------------------------------ */

/**
 * 选择态删除入口：无 pending → 进确认态；同一行再次触发 → 确认删除。
 *
 * 「确认按钮」与「二次 `Delete`」都走 `delete(line)` 经此分派，渲染层无需维护
 * 两套语义。非同一行（理论上不会发生）视为一次新的确认请求。
 */
export async function requestDelete(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	if (view.pendingDeleteLine === line) {
		view.confirmPendingDelete();
		return;
	}
	// 常规编辑卡：先提交标题（退出编辑）再进确认，串行化「blur 提交」与「删除写盘」，
	// 避免提交把行删掉 / 未落盘即删的竞态（坑 2）。
	// 放大卡（zoomLine === line）不在此提交：方案 A 下编辑器常驻编辑态、blur 走
	// flushZoomEdit 只落盘不退编辑；强行 commitEdit 会破坏「放大 ≡ 编辑」不变量，
	// 且取消确认后会留下「is-zoomed 但非 is-editing」的瞬时残留（见 §四）。
	if (
		isCardEditing(view.editingKind) &&
		view.editingLine === line &&
		view.zoomLine !== line
	) {
		await view.commitEdit();
	}
	enterPendingDelete(view, line);
}

/**
 * 在当前卡片上盖一层遮罩 + 居中的确认/取消按钮。
 *
 * 焦点**不移动**（仍留在 `cardEl`）：键盘全部走既有卡片 `keydown`，避免在视图里
 * 重写一套 `collectCardLines`/`pickAdjacentLine` 导航（[[Plan-20261005-141853]] 步骤 5）。
 */
export function enterPendingDelete(view: TaskViewHost, line: number): void {
	const cardEl = view.queryCard( line);
	if (!cardEl) {
		// 行已漂移：静默放弃，不进 pending
		return;
	}
	view.cancelPendingDelete(false); // 保证单例

	const overlay = cardEl.createDiv({
		cls: 'ioto-task-view__delete-confirm',
	});
	overlay.setAttr('role', 'alertdialog');
	overlay.setAttr(
		'aria-label',
		t('view.iotoTaskView.deleteConfirm.aria'),
	);

	const actions = overlay.createDiv({
		cls: 'ioto-task-view__delete-confirm-actions',
	});
	const ok = actions.createEl('button', {
		cls: 'ioto-task-view__delete-confirm-btn is-confirm',
		text: t('view.iotoTaskView.deleteConfirm.confirm'),
		attr: { type: 'button' },
	});
	const cancel = actions.createEl('button', {
		cls: 'ioto-task-view__delete-confirm-btn',
		text: t('view.iotoTaskView.deleteConfirm.cancel'),
		attr: { type: 'button' },
	});

	// 两个按钮都 stopPropagation：否则冒泡到卡片 click 会因卡已 is-selected 而误进编辑态
	ok.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		view.confirmPendingDelete();
	});
	cancel.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		view.cancelPendingDelete();
	});

	// Q8 防误触：点遮罩空白不取消，也不让焦点离开卡片
	overlay.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});
	overlay.addEventListener('click', (event) => {
		event.stopPropagation();
	});

	view.pendingDeleteLine = line;
	view.pendingDeleteEl = overlay;
	cardEl.addClass('is-pending-delete');
	cardEl.focus({ preventScroll: true });
	// 同步工具栏删除按钮的 pending 视觉态（§4.5）。
	view.refreshDeleteButtonVisibility();
}

/**
 * 撤下遮罩并清空 pending 状态（幂等）。
 *
 * 只移除遮罩类与 DOM，**不动 `selectedLine`**：取消后卡片仍保持 `.is-selected`。
 */
export function cancelPendingDelete(
	view: TaskViewHost,
	refocus = true,
): void {
	view.pendingDeleteEl?.remove();
	view.pendingDeleteEl = null;
	const line = view.pendingDeleteLine;
	view.pendingDeleteLine = null;
	// 同步工具栏删除按钮的 pending 视觉态（§4.5）；确认成功后由 `confirmPendingDelete`
	// 先经此回到非 pending，再走 `deleteSelected`。
	view.refreshDeleteButtonVisibility();
	if (line !== null) {
		const cardEl = view.queryCard( line);
		cardEl?.removeClass('is-pending-delete');
		if (refocus) {
			cardEl?.focus({ preventScroll: true });
		}
	}
}

/**
 * 确认删除：先清遮罩/置空 pending，再走既有 `deleteSelected()`。
 *
 * **不另写行号计算**——`nextLine`、conflict/unchanged、整树重建、选择回填全部沿用
 * 既有链路（坑 G）。
 */
export function confirmPendingDelete(view: TaskViewHost): void {
	const line = view.pendingDeleteLine;
	if (line === null) {
		return;
	}
	view.cancelPendingDelete(false);
	void view.deleteSelected(line);
}

/**
 * 选择态 `Shift+Enter`：在选中卡片**下方**插入一张同级空卡片
 * （同 indent / 同列表符号 / 未勾选 / 不继承控制项），随后自动进入其编辑态。
 *
 * 复用 `runLineAction`：写盘 → 同步 `data`/`lastLoadedText` → 整树重建（带滚动
 * 快照）→ `beginEdit(line + 1)`，冲突处理与选中回填全部沿用既有链路。
 * 原行不变，故新行恒为 `line + 1`。
 */
export async function insertSibling(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	const originalLine = view.lineAt( line);
	await view.runLineAction(
		line,
		originalLine,
		(raw) => {
			const sibling = buildSiblingTaskLine(raw, '');
			return sibling === null ? null : [raw, sibling];
		},
		// 新空卡落到「任务行 + 其下连续续行」之后，避免抢走原任务的续行
		line + 1 + view.countContinuationLines( line),
		{ insertAfterContinuations: true, animateRecentSwap: true },
	);
}

/**
 * 编辑态 `Shift+Enter`：进入该卡续写区——
 * 已有续行 → 编辑它（`beginContinuationEdit`）；无续行 → 起一个空草稿
 * （`beginNewContinuationEdit`）。与 Markdown View「`Enter` 新起一条 /
 * `Shift+Enter` 软换行续写」的手感一致。
 *
 * 注：选择态 `Shift+Enter` 仍是 `insertSibling`（新建同级任务），本条只服务编辑态；
 * 两态语义不同是 Johnny 拍板保留的（[[Plan-20261004-222507]] §七）。
 */
export async function beginContinuationOrNew(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		return; // 只读降级：静默（同「添加任务」口径）
	}
	if (view.continuationLine === line && view.continuationHandle) {
		return; // 同一张卡重复按 = no-op（对齐 beginContinuationEdit 的短路）
	}
	if (view.countContinuationLines( line) > 0) {
		await view.beginContinuationEdit(line);
		return;
	}
	await view.beginNewContinuationEdit(line);
}

/**
 * 视口兜底：结构性变更（回车新建末行 / 删除）后目标卡可能在视口外，
 * `block:'nearest'` 只在确实出视口时才滚动（[[Plan-20261003-094145]] §5.4）。
 * `select` 与 `beginEdit` 共用。
 */
export function scrollCardIntoView(view: TaskViewHost, cardEl: HTMLElement): void {
	const rect = cardEl.getBoundingClientRect();
	const scrollEl = view.contentEl.querySelector<HTMLElement>(
		'.ioto-task-view__scroll',
	);
	const viewRect = scrollEl?.getBoundingClientRect();
	if (viewRect && (rect.top < viewRect.top || rect.bottom > viewRect.bottom)) {
		cardEl.scrollIntoView({ block: 'nearest' });
	}
}

/**
 * 能否由 scope 接管 Mod+Enter：非编辑态 + 有选中卡 + 卡片仍在 DOM 里。
 *
 * 🔴 编辑态必须放行（返回 `undefined` 交给核心）：内联编辑器里可能有未提交
 * 正文，此时改标志位会让随后的 blur 提交判成冲突并丢字 —— 与原先
 * `render-note.ts` Enter 分支的那条红线一致。
 */
export function canToggleSelectedFromScope(view: TaskViewHost): boolean {
	if (isCardEditing(view.editingKind)) {
		return false;
	}
	// pending 期间屏蔽 Cmd/Ctrl+Enter 完成态切换：否则会经 Scope 改勾选态、刷单卡，
	// 遮罩语境失效（[[Plan-20261005-141853]] 步骤 1.4 / 坑 D）。
	if (view.pendingDeleteLine !== null) {
		return false;
	}
	if (view.selectedLine === null) {
		return false;
	}
	return view.queryCard( view.selectedLine) !== null;
}

/** scope 命中后的执行：复用点 checkbox 的同一条链路（乐观更新 + 原子写回）。 */
export function toggleSelectedFromScope(view: TaskViewHost): void {
	const line = view.selectedLine;
	if (line === null) {
		return;
	}
	const cardEl = view.queryCard( line);
	if (!cardEl) {
		return;
	}
	void view.toggleTask(line, cardEl);
}

/** 暴露给 select-mode scope 的宿主；由 `IOTOTaskView` 构造函数取用并挂到 `View.scope`，只有 activeLeaf 才参与分发。 */
export function modEnterHost(view: TaskViewHost): ModEnterHost {
	return {
		canToggleSelected: () => canToggleSelectedFromScope(view),
		toggleSelected: () => toggleSelectedFromScope(view),
	};
}

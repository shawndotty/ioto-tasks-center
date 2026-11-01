/**
 * Task View 任务卡片拖拽排序（含跨章节移动、跨层级挂载）。
 *
 * - 手势骨架与 `task-view-section-drag.ts` 完全同款：Pointer Events 单实现
 * （鼠标按下即拖；触摸须先长按再移动，未长按的滑动交还原生滚动）、8px 阈值、
 * 400ms 长按、指针捕获、48px 边缘自动滚动、Esc 取消、悬浮 ghost。
 * - 拖动单位是**块集合**（[[Plan-20261101-063126]]）：起手卡属于当前多选集 →
 *   整组按原相对顺序搬；否则收窄为单卡。多块支持同文件与跨文件落点
 *   （跨文件由 [[Plan-20261101-070535]] 落地：窗格 → 插到落点；文件级落点 →
 *   追加到目标「任务」节末）。
 * - 拖拽过程是纯 DOM 瞬态（ghost / 落点线 / 源块整树半透明），**不写盘、不重绘**；
 *   松手才经 `moveTaskBlocks` / `moveTaskBlock`（domain 纯函数）+ `commitBlockRange`
 *   一次原子区间重写，随后迁移折叠态 / 选中行并整树重建。
 * - 落点三类：① 任务卡（卡上缘 before / 下缘 after，成为该卡同级兄弟）；
 *   ② 章节（header → section-start；body 空白 → section-end；空章节也能接收）；
 *   ③ **文件级**（卡片内的 `[[任务文件]]` 链接 / 任务中心的任务行）→ 追加到目标
 *   文件的「任务」节末。
 * - 窗格判定：`evaluateDrop` 每次先用 `resolvePeerPaneAtPoint` 定位指针所在的
 *   `IOTOTask` 窗格；跨窗格落点还要过 `checkForeignDropTarget` 受理判据
 *   （[[Plan-20261031-205655]] §四.3b），不满足就整场不画指示线。
 *
 * 监听全部挂在每次 render 新建的 grip / 卡片 DOM 上（pointer capture 续传），
 * 随整树重建自然销毁，无需 register*。
 */

import { TFile, parseLinktext } from 'obsidian';

import {
	moveTaskBlock,
	moveTaskBlocks,
	normalizeMoveBlocks,
} from '../../tasks-center/note-structure';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { t } from '../../lang/helpter';
import { commitBlockRange } from './commit-task-line';
import {
	commitCrossFileMove,
	commitCrossFileMoveBlocks,
	commitCrossFileMoveBlocksToPath,
	commitCrossFileMoveToPath,
} from './task-view-cross-file-move';
import {
	commitMultiSelection,
	currentMultiSelection,
} from './task-view-multi-selection';
import { resetPeerPaneCache, resolvePeerPaneAtPoint } from './task-view-peer';
import { checkForeignDropTarget } from './task-view-transfer-guard';
import { remapTrackedLines } from './task-view-tracked-lines';
import type { PeerPane } from './task-view-peer';
import type {
	TaskDropPosition,
	TaskDropTarget,
	TaskMoveResult,
} from '../../tasks-center/note-structure';
import type { TaskCardDrag } from './render-note-types';
import type { TaskViewHost } from './task-view-host';

/** 鼠标 / 长按后移动超过该距离才进入拖拽（与 section-drag 同档）。 */
const CARD_DRAG_MOVE_THRESHOLD_PX = 8;
/** 触摸进入拖拽前的长按时长（与 section-drag 同档）。 */
const CARD_DRAG_LONG_PRESS_MS = 400;
/** 距滚动容器上下边缘多少 px 内开始自动滚动。 */
const EDGE_AUTO_SCROLL_ZONE_PX = 48;
/** 边缘自动滚动速度（px / 帧）。 */
const EDGE_AUTO_SCROLL_SPEED_PX = 14;
/** ghost 相对指针的偏移，避免遮挡落点横线。 */
const GHOST_OFFSET_PX = 12;
/** 卡片上下缘多少 px 内强制吸附 before / after（中线之外的命中带）。 */
const CARD_EDGE_BAND_PX = 14;

const CARD_SELECTOR = '.ioto-task-view__card';
const SECTION_SELECTOR = '.ioto-task-view__section';
const SECTION_HEADER_SELECTOR = '.ioto-task-view__section-header';
const CARD_TEXT_SELECTOR = '.ioto-task-view__card-text';

type DropTarget =
	| {
			kind: 'task';
			cardEl: HTMLElement;
			line: number;
			position: TaskDropPosition;
	  }
	| {
			kind: 'section-start';
			sectionEl: HTMLElement;
			sectionStartLine: number;
	  }
	| {
			kind: 'section-end';
			sectionEl: HTMLElement;
			sectionStartLine: number;
	  }
	| {
			/** 文件级落点：卡片内的任务文件链接 / 任务中心任务行。 */
			kind: 'file-link';
			file: TFile;
			el: HTMLElement;
	  };

type FileDropTarget = Extract<DropTarget, { kind: 'file-link' }>;

const DROP_CLASS_NAMES = [
	'is-drop-before',
	'is-drop-after',
	'is-section-drop-start',
	'is-section-drop-end',
	'is-file-drop-target',
] as const;

/** 落点稳定签名：指针移动时只在落点真的变化时才重刷指示线。 */
function dropSignature(drop: DropTarget | null, hoverPath: string): string {
	if (!drop) {
		return '';
	}
	// 🔴 前缀必须带目标路径：跨两个窗格时 `data-line` 会撞号（T2）。
	if (drop.kind === 'task') {
		return `${hoverPath}|task:${drop.line}:${drop.position}`;
	}
	if (drop.kind === 'file-link') {
		return `file:${drop.file.path}`;
	}
	return `${hoverPath}|section:${drop.kind}:${drop.sectionStartLine}`;
}

interface DragGestureState {
	pointerId: number | null;
	pointerType: string;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	longPressTimer: number | null;
	longPressFired: boolean;
	scrollAborted: boolean;
	dragging: boolean;
	ghostEl: HTMLElement | null;
	/** ghost 上的源卡片标题（跨窗格时拼成「标题 → 目标文件名」）。 */
	ghostBaseLabel: string;
	autoScrollRaf: number | null;
	drop: DropTarget | null;
	/** 指针当前所在的窗格（含源窗格）；`evaluateDrop` 每次重算。 */
	hover: PeerPane | null;
	/** 落点签名用的目标路径（跨窗格撞号防护，T2）。 */
	hoverPath: string;
	/** 当前挂受理框 `.is-foreign-drop-target` 的窗格（换窗格时先摘旧的）。 */
	hoverEl: HTMLElement | null;
	/** 落点类的显式账本：跨两个 pane 都要能清（T3）。 */
	markedEls: HTMLElement[];
	/** 被打过「拖拽中禁选」的 scrollEl（源 + 曾进入过的目标）。 */
	touchedScrollEls: Set<HTMLElement>;
	/** 手势发生所在的文档（v1 只支持同文档，不跨 popout 窗口）。 */
	doc: Document | null;
	/** 本源集合的任务行号（升序；长度 1 = 单卡）。 */
	sourceLines: number[];
	/** 这些任务行的块区间（含子树），用于整树半透明与「落进自身」排除。 */
	sourceBlocks: Array<{ startLine: number; endLine: number }>;
	/** 拖拽中被打半透明标记的源块卡片（复位时逐张清类）。 */
	sourceCardEls: HTMLElement[];
}

/** 视图侧控制器：渲染层建好 grip 后调用 `attachHandle`。 */
export function buildCardDragController(view: TaskViewHost): TaskCardDrag {
	return {
		attachHandle(handleEl, cardEl, scrollEl) {
			attachCardDragHandle(view, handleEl, cardEl, scrollEl);
		},
	};
}

function attachCardDragHandle(
	view: TaskViewHost,
	handleEl: HTMLElement,
	cardEl: HTMLElement,
	scrollEl: HTMLElement,
): void {
	const state: DragGestureState = {
		pointerId: null,
		pointerType: '',
		startX: 0,
		startY: 0,
		lastX: 0,
		lastY: 0,
		longPressTimer: null,
		longPressFired: false,
		scrollAborted: false,
		dragging: false,
		ghostEl: null,
		ghostBaseLabel: '',
		autoScrollRaf: null,
		drop: null,
		hover: null,
		hoverPath: '',
		hoverEl: null,
		markedEls: [],
		touchedScrollEls: new Set<HTMLElement>(),
		doc: null,
		sourceLines: [],
		sourceBlocks: [],
		sourceCardEls: [],
	};

	const clearLongPressTimer = (): void => {
		if (state.longPressTimer !== null) {
			window.clearTimeout(state.longPressTimer);
			state.longPressTimer = null;
		}
	};

	const clearDropClasses = (): void => {
		// 🔴 用显式账本而不是 `scrollEl.querySelectorAll`：落点可能画在**另一个**
		// 窗格里，只扫源窗格会留下永久高亮（T3）。
		for (const el of state.markedEls) {
			el.classList.remove(...DROP_CLASS_NAMES);
		}
		state.markedEls = [];
	};

	const destroyGhost = (): void => {
		state.ghostEl?.remove();
		state.ghostEl = null;
	};

	const stopAutoScroll = (): void => {
		if (state.autoScrollRaf !== null) {
			window.cancelAnimationFrame(state.autoScrollRaf);
			state.autoScrollRaf = null;
		}
	};

	const resetGesture = (): void => {
		// 先置 false 再释放捕获：release 会触发 lostpointercapture，
		// 若此时 dragging 仍为 true 会重入本函数。
		state.dragging = false;
		clearLongPressTimer();
		stopAutoScroll();
		destroyGhost();
		clearDropClasses();
		for (const el of state.sourceCardEls) {
			el.classList.remove('is-dragging');
		}
		state.sourceCardEls = [];
		state.sourceLines = [];
		state.sourceBlocks = [];
		// 跨窗格时曾进入过的每个目标窗格都被打过 `is-card-dragging`，统一在此摘。
		for (const el of state.touchedScrollEls) {
			el.classList.remove('is-card-dragging');
		}
		state.touchedScrollEls.clear();
		scrollEl.classList.remove('is-card-dragging');
		if (state.hoverEl) {
			state.hoverEl.classList.remove('is-foreign-drop-target');
		}
		state.hoverEl = null;
		state.hover = null;
		state.hoverPath = '';
		state.doc = null;
		handleEl.setAttribute('aria-grabbed', 'false');
		// 🔴 必须带 capture:true，与 `beginDrag` 的注册参数逐项一致：
		// `removeEventListener` 按 (type, listener, capture) 三元组匹配，省略第三参
		// 等于 `capture:false` → 摘不掉，每次拖拽都会在 window 捕获阶段留下一个
		// 永久吞掉 Esc 的监听器（[[Research-20261017-150117]]）。
		window.removeEventListener('keydown', onKeydown, true);
		if (
			state.pointerId !== null &&
			typeof handleEl.releasePointerCapture === 'function'
		) {
			try {
				handleEl.releasePointerCapture(state.pointerId);
			} catch {
				// 指针已释放时 releasePointerCapture 会抛错，忽略。
			}
		}
		state.pointerId = null;
		state.longPressFired = false;
		state.scrollAborted = false;
		state.drop = null;
		// 注销「就地收尸」入口（仅在仍指向自己时清，避免踩掉别的卡片的登记）。
		if (view.cancelActiveDrag === resetGesture) {
			view.cancelActiveDrag = undefined;
		}
	};

	function onKeydown(event: KeyboardEvent): void {
		// 兜底：本监听器挂在 window 捕获阶段，一旦因任何原因没被摘掉，只要手势
		// 已结束就必须保持沉默——否则它会在全局吃掉所有 Esc（回归事故的形态）。
		if (!state.dragging) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			resetGesture();
		}
	}

	const isSourceBlockCard = (el: HTMLElement): boolean => {
		const line = Number.parseInt(el.dataset.line ?? '', 10);
		if (Number.isNaN(line)) {
			return false;
		}
		return state.sourceBlocks.some(
			(block) => line >= block.startLine && line <= block.endLine,
		);
	};

	/**
	 * 起手卡属于当前多选集 → 整组；否则单卡（并先把多选收窄成这张）。
	 *
	 * 与 Q2「多选态点已选卡 → 收窄」同语义：拖组外的卡就是宣告「我只要这一张」，
	 * 否则会出现「拖一张却带走三张」的惊吓（[[Plan-20261101-063126]] §三-3/T3）。
	 */
	const resolveDragGroup = (fromLine: number): number[] => {
		const { anchor, members } = currentMultiSelection(view);
		if (anchor === null || members.length === 0) {
			return [fromLine];
		}
		if (anchor === fromLine || members.includes(fromLine)) {
			return [anchor, ...members].sort((a, b) => a - b);
		}
		commitMultiSelection(view, { anchor: fromLine, members: [] });
		return [fromLine];
	};

	const beginDrag = (): boolean => {
		// 放大态 / 「只看本节」不排序（提交侧也有守卫，这里拦在视觉发生之前）。
		// v1 在节聚焦下整体禁用卡片拖拽：兜底落点取 DOM 末节、不看可见性
		// （[[Research-20261019-131228]] §1.4-2 / §4.6）。
		if (
			view.zoomLine !== null ||
			view.sectionZoomLine !== null ||
			!view.file
		) {
			return false;
		}
		const fromLine = Number.parseInt(cardEl.dataset.line ?? '', 10);
		if (Number.isNaN(fromLine) || !view.data) {
			return false;
		}
		// 手势文档快照：popout 里的源视图拿 `activeDocument` 会问错文档；v1 不跨窗口，
		// 两者不一致时整次手势放弃（[[Plan-20261031-205655]] §六）。
		const doc = cardEl.ownerDocument;
		if (!doc || doc !== activeDocument) {
			return false;
		}
		state.doc = doc;
		resetPeerPaneCache();
		// 源集合：起手卡属于当前多选集 → 整组；否则单卡（顺带收窄多选）。
		// 块 = 任务行 + 整块更深子树（domain 同一口径），用来①整树半透明
		// ②排除「落进自身」的落点（domain 另有成环保护，这里先消除误导指示线）。
		const group = resolveDragGroup(fromLine);
		const blocks = normalizeMoveBlocks(view.data, group);
		if (blocks.length === 0) {
			// 任一行号失效 → 放弃整次手势（没有可搬的块，画 ghost 只会误导）。
			// 注意：父子同选时 blocks.length < group.length 是**合法**的归一，不在此列。
			return false;
		}
		state.sourceLines = group;
		state.sourceBlocks = blocks.map(({ startLine, endLine }) => ({
			startLine,
			endLine,
		}));

		if (
			state.pointerId !== null &&
			typeof handleEl.setPointerCapture === 'function'
		) {
			try {
				handleEl.setPointerCapture(state.pointerId);
			} catch {
				// 某些环境 setPointerCapture 可能抛错，忽略即可。
			}
		}
		state.dragging = true;
		scrollEl.classList.add('is-card-dragging');
		state.touchedScrollEls.add(scrollEl);
		handleEl.setAttribute('aria-grabbed', 'true');
		window.addEventListener('keydown', onKeydown, { capture: true });

		scrollEl
			.querySelectorAll<HTMLElement>(CARD_SELECTOR)
			.forEach((el) => {
				if (isSourceBlockCard(el)) {
					el.classList.add('is-dragging');
					state.sourceCardEls.push(el);
				}
			});

		const label =
			group.length > 1
				? t('view.iotoTaskView.cardDragGroup', [String(group.length)])
				: cardEl.querySelector(CARD_TEXT_SELECTOR)?.textContent?.trim() ||
					cardEl.dataset.taskKey ||
					'';
		const ghostEl = doc.createElement('div');
		ghostEl.className = 'ioto-task-view__card-drag-ghost';
		ghostEl.textContent = label;
		ghostEl.style.maxWidth = `${Math.round(scrollEl.clientWidth * 0.8)}px`;
		doc.body.appendChild(ghostEl);
		state.ghostEl = ghostEl;
		state.ghostBaseLabel = label;
		moveGhost(state.lastX, state.lastY);

		const autoScrollLoop = (): void => {
			if (!state.dragging) {
				state.autoScrollRaf = null;
				return;
			}
			const activeScrollEl = state.hover?.scrollEl ?? scrollEl;
			const rect = activeScrollEl.getBoundingClientRect();
			if (state.lastY - rect.top < EDGE_AUTO_SCROLL_ZONE_PX) {
				activeScrollEl.scrollBy(0, -EDGE_AUTO_SCROLL_SPEED_PX);
				evaluateDrop();
			} else if (
				rect.bottom - state.lastY <
				EDGE_AUTO_SCROLL_ZONE_PX
			) {
				activeScrollEl.scrollBy(0, EDGE_AUTO_SCROLL_SPEED_PX);
				evaluateDrop();
			}
			state.autoScrollRaf = window.requestAnimationFrame(autoScrollLoop);
		};
		state.autoScrollRaf = window.requestAnimationFrame(autoScrollLoop);
		evaluateDrop();
		// 登记「就地收尸」入口：整树重建 / 关笔记前由 renderNote / clear 调用。
		view.cancelActiveDrag = resetGesture;
		return true;
	};

	const moveGhost = (clientX: number, clientY: number): void => {
		const ghostEl = state.ghostEl;
		if (!ghostEl) {
			return;
		}
		ghostEl.style.transform = `translate(${clientX + GHOST_OFFSET_PX}px, ${
			clientY + GHOST_OFFSET_PX
		}px)`;
	};

	/** 盒内空白（底部加号行 / 章节留白）的兜底落点：末章节 section-end。 */
	const resolveFallbackDrop = (
		paneScrollEl: HTMLElement,
	): DropTarget | null => {
		const rect = paneScrollEl.getBoundingClientRect();
		const inside =
			state.lastX >= rect.left &&
			state.lastX <= rect.right &&
			state.lastY >= rect.top &&
			state.lastY <= rect.bottom;
		if (!inside) {
			return null;
		}
		// 只认有布局盒的节：只看本节 / 卡片放大下其它节是 display:none 但仍在 DOM，
		// 取「末项」会兜到隐藏节（[[Research-20261101-114007]] §五 T3）。
		// 口径同 card-navigation.ts 的 isVisiblyLaidOut（getClientRects 零盒判定）。
		const sections = Array.from(
			paneScrollEl.querySelectorAll<HTMLElement>(SECTION_SELECTOR),
		).filter((el) => el.getClientRects().length > 0);
		const last = sections[sections.length - 1];
		if (!last) {
			return null;
		}
		const sectionStartLine = Number.parseInt(
			last.dataset.startLine ?? '',
			10,
		);
		if (Number.isNaN(sectionStartLine)) {
			return null;
		}
		return {
			kind: 'section-end',
			sectionEl: last,
			sectionStartLine,
		};
	};

	/**
	 * 文件级落点（A′-1 卡片内 `[[任务文件]]` 链接 / A′-2 任务中心任务行）。
	 * 两者的差别只有「怎么从 DOM 拿到 `TFile`」，下游写盘完全共用。
	 */
	const resolveFileDropTarget = (
		hitEl: HTMLElement | null,
	): FileDropTarget | null => {
		const srcPath = view.file?.path;
		if (!srcPath) {
			return null;
		}
		const policy = view.taskFileLinkPolicyProvider();

		const linkEl = hitEl?.closest('a.internal-link') as HTMLElement | null;
		const href = linkEl?.getAttribute('data-href') ?? '';
		if (linkEl && href) {
			const target = view.app.metadataCache.getFirstLinkpathDest(
				parseLinktext(href).path,
				srcPath,
			);
			if (
				target instanceof TFile &&
				target.path !== srcPath &&
				isTaskNoteFile(target, policy.tasksRootPath)
			) {
				return { kind: 'file-link', file: target, el: linkEl };
			}
		}

		const rowEl = hitEl?.closest('[data-task-path]') as HTMLElement | null;
		const rowPath = rowEl?.dataset.taskPath;
		if (rowEl && rowPath && rowPath !== srcPath) {
			const target = view.app.vault.getAbstractFileByPath(rowPath);
			if (
				target instanceof TFile &&
				isTaskNoteFile(target, policy.tasksRootPath)
			) {
				return { kind: 'file-link', file: target, el: rowEl };
			}
		}

		return null;
	};

	/**
	 * ghost 文案：`基础文案` + 可选「→ 目标」。窗格落点与文件级落点共用
	 * （[[Plan-20261101-070535]] §三-9）——文件级落点走 `setHoverPane(null)`，
	 * 不能只靠 `updateGhostLabel` 拼后缀。
	 */
	const setGhostTarget = (targetName: string): void => {
		const ghostEl = state.ghostEl;
		if (!ghostEl) {
			return;
		}
		ghostEl.textContent = targetName
			? `${state.ghostBaseLabel} → ${targetName}`
			: state.ghostBaseLabel;
	};

	/** 更新 ghost 文案：跨窗格时补上「→ 目标文件名」。 */
	const updateGhostLabel = (pane: PeerPane | null): void => {
		setGhostTarget(
			pane && pane.view !== view
				? (pane.view.file?.basename ?? '')
				: '',
		);
	};

	/** 更新「指针在哪个窗格」及其视觉回执（受理框 / ghost 文案）。 */
	const setHoverPane = (pane: PeerPane | null): void => {
		if (
			(state.hover?.view ?? null) === (pane?.view ?? null) &&
			(state.hover?.scrollEl ?? null) === (pane?.scrollEl ?? null)
		) {
			return;
		}
		state.hoverEl?.classList.remove('is-foreign-drop-target');
		state.hoverEl = null;
		if (pane && pane.view !== view) {
			// 只有「别的窗格」才画受理框；源窗格保持原样（不新造视觉）。
			pane.scrollEl.classList.add('is-foreign-drop-target');
			state.hoverEl = pane.scrollEl;
			if (!state.touchedScrollEls.has(pane.scrollEl)) {
				pane.scrollEl.classList.add('is-card-dragging');
				state.touchedScrollEls.add(pane.scrollEl);
			}
		}
		state.hover = pane;
		state.hoverPath = pane?.view.file?.path ?? '';
		updateGhostLabel(pane);
	};

	/** 落点变化时才重刷指示线（类名一律记账到 `markedEls`，跨窗格也能清干净）。 */
	const applyDrop = (next: DropTarget | null): void => {
		if (
			dropSignature(next, state.hoverPath) ===
			dropSignature(state.drop, state.hoverPath)
		) {
			return;
		}
		clearDropClasses();
		state.drop = next;
		if (!next) {
			return;
		}
		if (next.kind === 'task') {
			next.cardEl.classList.add(
				next.position === 'before'
					? 'is-drop-before'
					: 'is-drop-after',
			);
			state.markedEls.push(next.cardEl);
			return;
		}
		if (next.kind === 'file-link') {
			next.el.classList.add('is-file-drop-target');
			state.markedEls.push(next.el);
			return;
		}
		next.sectionEl.classList.add(
			next.kind === 'section-start'
				? 'is-section-drop-start'
				: 'is-section-drop-end',
		);
		state.markedEls.push(next.sectionEl);
	};

	const evaluateDrop = (): void => {
		const doc = state.doc;
		if (!doc) {
			return;
		}
		const hit = resolvePeerPaneAtPoint(
			view.app,
			doc,
			state.lastX,
			state.lastY,
		);

		// ⓪ 文件级落点必须**早于**卡片命中判定，否则永远是「落进那张卡」。
		//    整组同样受理（P3）：落点语义是「追加到目标文件任务节末」，与组大小无关。
		const fileDrop = resolveFileDropTarget(hit.el);
		if (fileDrop) {
			setHoverPane(null);
			applyDrop(fileDrop);
			setGhostTarget(fileDrop.file.basename);
			return;
		}

		// ① 先定窗格：不在任何 IOTOTask 窗格里 / 目标窗格不受理 → 不画任何指示线。
		//    整组也可跨窗格（P3），受理判据保持不变。
		const pane = hit.pane;
		const foreignOk = pane
			? pane.view === view ||
				checkForeignDropTarget(pane.view, view.file?.path ?? '').ok
			: false;
		if (!pane || !foreignOk) {
			setHoverPane(null);
			applyDrop(null);
			return;
		}
		setHoverPane(pane);
		const paneScrollEl = pane.scrollEl;
		// 🔴 自身子树排除只在源窗格生效：跨文件时行号会撞号（T1）。
		const samePane = pane.view === view;

		let next: DropTarget | null = null;

		// ② 命中非源块任务卡：上缘 before / 下缘 after（边缘 14px 吸附带，
		// 其余按卡中线分），语义 = 成为该卡的同级兄弟。
		const cardHit = hit.el?.closest(CARD_SELECTOR) as HTMLElement | null;
		if (
			cardHit &&
			paneScrollEl.contains(cardHit) &&
			!(samePane && isSourceBlockCard(cardHit))
		) {
			const line = Number.parseInt(cardHit.dataset.line ?? '', 10);
			if (!Number.isNaN(line)) {
				const rect = cardHit.getBoundingClientRect();
				const offset = state.lastY - rect.top;
				let position: TaskDropPosition;
				if (offset <= CARD_EDGE_BAND_PX) {
					position = 'before';
				} else if (rect.height - offset <= CARD_EDGE_BAND_PX) {
					position = 'after';
				} else {
					position = offset < rect.height / 2 ? 'before' : 'after';
				}
				next = { kind: 'task', cardEl: cardHit, line, position };
			}
		}

		// ③ 命中章节：header → section-start；正文空白（含源块自身、续行、
		// markdown chunk）→ section-end。空 / 折叠章节也能接收（折叠态只有
		// header，仍可命中 start；end 与 start 同缝，domain 幂等）。
		if (!next) {
			const sectionHit = hit.el?.closest(
				SECTION_SELECTOR,
			) as HTMLElement | null;
			if (sectionHit && paneScrollEl.contains(sectionHit)) {
				const sectionStartLine = Number.parseInt(
					sectionHit.dataset.startLine ?? '',
					10,
				);
				if (!Number.isNaN(sectionStartLine)) {
					const headerHit = hit.el?.closest(
						SECTION_HEADER_SELECTOR,
					) as HTMLElement | null;
					const overHeader =
						headerHit !== null &&
						sectionHit.contains(headerHit);
					next = overHeader
						? {
								kind: 'section-start',
								sectionEl: sectionHit,
								sectionStartLine,
							}
						: {
								kind: 'section-end',
								sectionEl: sectionHit,
								sectionStartLine,
							};
				}
			}
		}

		// ④ 盒内、所有 section 之外的空白（底部加号行等）→ 文末。
		if (!next) {
			next = resolveFallbackDrop(paneScrollEl);
		}

		applyDrop(next);
	};

	const finishDrag = (): void => {
		const drop = state.drop;
		// 🔴 组快照必须在 resetGesture 之前取（reset 会把 sourceLines 换新）。
		const group = state.sourceLines;
		const first = group[0];
		const dst = state.hover?.view ?? null;
		// 先复位视觉，再做异步写盘（写盘后整树重建，旧 DOM 必已弃用）。
		resetGesture();
		if (!drop || first === undefined) {
			return;
		}
		if (drop.kind === 'file-link') {
			// A′-1 / A′-2：目标没有视图，走「追加到任务节末」通道。
			// 单块走老入口（零回归），整组走多块入口（P3）。
			if (group.length === 1) {
				void commitCrossFileMoveToPath(view, first, drop.file);
				return;
			}
			void commitCrossFileMoveBlocksToPath(view, group, drop.file);
			return;
		}
		const target: TaskDropTarget =
			drop.kind === 'task'
				? {
						kind: 'task',
						line: drop.line,
						position: drop.position,
					}
				: {
						kind: 'section',
						sectionStartLine: drop.sectionStartLine,
						position:
							drop.kind === 'section-start' ? 'start' : 'end',
					};
		if (!dst || dst === view) {
			void commitCardMove(view, group, target);
			return;
		}
		// 跨窗格：单块走老入口（零回归），整组走多块入口（P3）。
		if (group.length === 1) {
			void commitCrossFileMove(view, dst, first, target);
			return;
		}
		void commitCrossFileMoveBlocks(view, dst, group, target);
	};

	handleEl.addEventListener('pointerdown', (event: PointerEvent) => {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}
		state.pointerId = event.pointerId;
		state.pointerType = event.pointerType;
		state.startX = event.clientX;
		state.startY = event.clientY;
		state.lastX = event.clientX;
		state.lastY = event.clientY;
		state.longPressFired = false;
		state.scrollAborted = false;
		state.drop = null;
		// 🔴 起手的 8px 必须在 18px 手柄盒内走完，否则指针先离开图标 →
		// 本元素再也收不到 pointermove（[[Research-20261017-112730]] §三：0 次起拖）。
		// 捕获提前到 pointerdown：阈值退回纯防抖，不再受手柄几何限制。
		try {
			handleEl.setPointerCapture(event.pointerId);
		} catch {
			// 指针已失效 / 环境不支持时抛错，忽略（pointerup 另有兜底）。
		}
		clearLongPressTimer();
		// 触摸 / 触控笔需要「先长按」；鼠标直接按下移动即可拖。
		if (event.pointerType !== 'mouse') {
			state.longPressTimer = window.setTimeout(() => {
				state.longPressTimer = null;
				state.longPressFired = true;
			}, CARD_DRAG_LONG_PRESS_MS);
		}
	});

	handleEl.addEventListener('pointermove', (event: PointerEvent) => {
		if (
			state.pointerId === null ||
			event.pointerId !== state.pointerId
		) {
			return;
		}
		if (state.scrollAborted) {
			return;
		}
		state.lastX = event.clientX;
		state.lastY = event.clientY;

		if (!state.dragging) {
			const dist = Math.hypot(
				event.clientX - state.startX,
				event.clientY - state.startY,
			);
			if (dist < CARD_DRAG_MOVE_THRESHOLD_PX) {
				return;
			}
			// 触摸：未触发长按的位移视为列表滚动，整次触摸放弃拖拽。
			if (state.pointerType !== 'mouse' && !state.longPressFired) {
				state.scrollAborted = true;
				clearLongPressTimer();
				return;
			}
			clearLongPressTimer();
			if (!beginDrag()) {
				state.scrollAborted = true;
				return;
			}
		}

		event.preventDefault();
		moveGhost(event.clientX, event.clientY);
		evaluateDrop();
	});

	handleEl.addEventListener('pointerup', (event: PointerEvent) => {
		if (
			state.pointerId === null ||
			event.pointerId !== state.pointerId
		) {
			return;
		}
		state.lastX = event.clientX;
		state.lastY = event.clientY;
		if (state.dragging) {
			finishDrag();
		} else {
			resetGesture();
		}
	});

	handleEl.addEventListener('pointercancel', () => {
		resetGesture();
	});

	// 手柄被移出文档 / display:none / 系统回收指针时捕获会静默丢失，
	// 这一路必定收不到 pointerup → 不收尸就永久冻住 ghost（只能 Esc）。
	handleEl.addEventListener('lostpointercapture', () => {
		if (state.dragging) {
			resetGesture();
		}
	});

	// 拖拽进行中拦截原生滚动（必须 non-passive；同 section-drag 口径）。
	handleEl.addEventListener(
		'touchmove',
		(event: TouchEvent) => {
			if (state.dragging) {
				event.preventDefault();
			}
		},
		{ passive: false },
	);
}

/**
 * 松手后的写盘编排（口径对齐 `commitSectionReorder` / `swapSelectedTask`）：
 * 守卫 → 落盘在册编辑器 → 纯函数移动 → 原子区间写 → 状态行号迁移 → 整树重建
 * → 补回焦点。
 *
 * 单块继续走 `moveTaskBlock`（19 条单测是回归基线）；多块走 `moveTaskBlocks`，
 * 两条分支之后共用同一段写盘尾巴。
 */
async function commitCardMove(
	view: TaskViewHost,
	fromLines: readonly number[],
	target: TaskDropTarget,
): Promise<void> {
	const file = view.file;
	if (
		!file ||
		!view.supportsInlineEdit() ||
		!view.data ||
		fromLines.length === 0
	) {
		return;
	}

	// 先落盘在册编辑器（卡片 / 续写 / Section），否则按行号取块会取到旧字节。
	await view.flushInlineEdits();
	if (view.zoomLine !== null) {
		view.exitZoom();
	}
	view.cancelPendingDelete(false);

	const result: TaskMoveResult | null =
		fromLines.length > 1
			? moveTaskBlocks(view.data, fromLines, target)
			: moveTaskBlock(view.data, fromLines[0] ?? -1, target);
	if (!result) {
		// 等价槽位 / 成环 / 参数无效：纯函数未产出变化，按当前数据重建复原视觉。
		view.renderNote(view.data);
		return;
	}

	const outcome = await commitBlockRange(view.app, file, {
		startLine: result.startLine,
		endLine: result.endLine,
		originalLines: result.originalLines,
		nextText: result.nextLines.join('\n'),
		// 🔴 必须显式给 `nextLines`：`nextText` 的「全空白 = 删块」折叠会吞掉
		// 纯空行结果（[[Report-20261101-055822]] §四-4）。
		nextLines: result.nextLines,
	});
	// 🔴 红线：data / lastLoadedText 同步（conflict 会弹 Notice）。
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		return; // unchanged：无写入、跟踪态不动
	}

	// 🔴 先 remap（含多选三字段，见 task-view-tracked-lines）再重绘：
	// renderNote 末尾的 syncSelectionClass 按 selectedLine 画类，旧行号会画错卡。
	remapTrackedLines(view, (line) => result.mapLine(line));
	view.renderNote(view.data);

	// 🔴 重绘会重建 DOM、焦点掉到 body → 紧接着按 Esc / Delete 全断。
	// `preventScroll` 只补焦点：落点本来就在指针附近，跳视口会让人以为搬错了地方。
	const anchor = view.selectedLine;
	if (anchor !== null) {
		view.queryCard(anchor)?.focus({ preventScroll: true });
	}
	view.refreshDeleteButtonVisibility();
}

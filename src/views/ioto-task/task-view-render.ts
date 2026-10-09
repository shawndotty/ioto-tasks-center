import {
	captureCardSnapshots,
	prepareSwapTransition,
} from './list-transition';
import {
	captureIotoTaskScroll,
	restoreIotoTaskScroll,
	IOTO_TASK_CARD_SELECTOR,
	IOTO_TASK_SCROLL_SELECTOR,
} from './ioto-task-scroll';
import { renderTaskNote } from './render-note';
import type { TaskNoteEditing, TaskNoteLinks } from './render-note-types';
import { collectCardLines, pickEdgeLine } from './card-navigation';
import {
	EDIT_ITEM_CONTROLS_COMMAND_ID,
	INSERT_OUTGOING_LINK_COMMAND_ID,
} from './task-view-constants';
import { queryCard } from './task-view-helpers';
import {
	IOTO_TASK_VIEW_HOVER_SOURCE_ID,
	type TaskHoverPreviewPayload,
} from '../task-hover-preview';
import type { TaskViewHost } from './task-view-host';

/** 视图级渲染主入口：重建列表容器，保留常驻外壳，处理动画 / 选中回填 / 命令就绪补偿。 */
export function renderNote(
	view: TaskViewHost,
	data: string,
	options?: {
		skipAnchorRestore?: boolean;
		animateRecentSwap?: boolean;
		/** 搜索结果集与滚动锚点无关：置顶（跳过「捕获-恢复」） */
		resetScroll?: boolean;
	},
): void {
	if (view.isRendering) {
		return;
	}

	view.isRendering = true;
	// 新一次渲染立即作废上一场进出场动画（避免叠影）：`bodyEl.empty()` 会顺带
	// 销毁旧浮层，但异步 rAF 回调仍需令牌作废（[[Plan-20261005-150106]] §2.4）。
	view.cancelListTransition();
	try {
		// 整树重建会连遮罩一起清掉：先置空 pending 状态，避免旧行号悬空误删
		//（[[Plan-20261005-141853]] 坑 B）。幂等，无 pending 时为 no-op。
		view.cancelPendingDelete(false);
		// 兼容「setViewData 先于 onOpen」/ 外壳被清空的时序：缺失时补建。
		if (!view.bodyEl?.isConnected) {
			view.buildToolbar();
		}

		// 过滤开关以 frontmatter 为唯一真源：每次重绘都重读（多视图 / 外部改动自动对齐）。
		view.reloadFilters();
		view.refreshToolbarState();

		// 重绘会新建滚动容器（render-note.ts:60），scrollTop 会归零；
		// 先捕获、render 之后恢复，保证结构性变更（回车新建 / 折叠 Section / 冲突回滚）
		// 不把用户看到的视口位置丢掉（[[Plan-20261003-094145]] §5.2）。
		const snapshot = options?.resetScroll
			? null
			: captureIotoTaskScroll(view.contentEl);

		// 进出场动效门控：只对「①③ 单任务增删」放行（residual 重建保持即时）。
		// 必须在 `empty()` 前采旧集——旧卡节点会被 empty() 摘除，但引用仍在内存。
		const animate =
			options?.animateRecentSwap === true &&
			view.filters.recentOnly &&
			// 放大态下同 Section 其余卡是 `display: none`（`.is-zoom-hidden`），
			// 此态采几何会把隐藏卡量成 0×0，退出的卡被搬到视口原点、以 0 宽渲染成
			// 竖排文字闪现（[[Research-20261008-191548]]）。放大期间不动画。
			view.zoomLine === null &&
			!prefersReducedMotion(view);
		const scrollElBefore =
			view.bodyEl?.querySelector<HTMLElement>(
				IOTO_TASK_SCROLL_SELECTOR,
			) ?? null;
		const oldSnapshots =
			animate && scrollElBefore
				? captureCardSnapshots(scrollElBefore, IOTO_TASK_CARD_SELECTOR)
				: [];

		// 只重建列表容器，控制栏外壳常驻（批次 A）。
		view.bodyEl?.empty();
		renderTaskNote({
			app: view.app,
			containerEl: view.bodyEl ?? view.contentEl,
			content: data,
			sourcePath: view.file?.path ?? '',
			component: view,
			collapsedSections: view.collapsedSections,
			onToggleSection: (key) => {
				if (view.collapsedSections.has(key)) {
					view.collapsedSections.delete(key);
				} else {
					view.collapsedSections.add(key);
				}
				view.renderNote(view.data);
			},
			editing: buildEditingController(view),
			links: buildLinkController(view),
			filters: view.filters,
			recentTaskCount: view.recentTaskCountProvider(),
			searchQuery: view.searchQuery,
		});
		if (snapshot) {
			restoreIotoTaskScroll(view.contentEl, snapshot, {
				skipAnchor: options?.skipAnchorRestore ?? false,
			});
		} else {
			// 搜索应用 / 清空：结果集与锚点无关，直接归顶。
			const scrollEl = view.bodyEl?.querySelector<HTMLElement>(
				IOTO_TASK_SCROLL_SELECTOR,
			);
			if (scrollEl) {
				scrollEl.scrollTop = 0;
			}
		}
		// 回填选中类：整树重建后 `selectedLine` 仍在，但不 `focus()`——
		// `renderNote` 也会被后台 `reloadFromVault` 触发，抢焦点会打断用户输入
		// （[[Plan-20261003-194909]] §5.1f）。
		syncSelectionClass(view);
		// 放大态跨重绘回填（[[Discuss-20261008-171512]] 方案 A 步骤 1/2）：
		// `zoomLine` 是内存真源，整树重建后须与选中态同口径回填，否则放大视觉丢失、
		// 与 `zoomLine` 错位（图标说放大、界面没放大）。
		view.restoreZoom();
		// 整树重建后重算删除按钮显隐（落点 A 在 `bodyEl.empty()` 之前、DOM 还是旧的，§4.4 坑 B）。
		view.refreshDeleteButtonVisibility();
		// 结果集变化后同步定位按钮可用态（无命中 → 两个按钮 disabled）。
		view.refreshSearchNavState();

		// 选中态稳定后启动动画（[[Plan-20261005-150106]] 坑 7）。
		// [[Plan-20261005-152203]] §3.2：改为「同步 prepare + 双 rAF play」——
		// prepare 在 renderNote 返回前定格起点态，浏览器绘制新列表的第一帧即起点态，
		// 不再先闪最终态再跳回起点；play 延到双 rAF（等布局 + 异步落字稳定）后起播。
		if (animate && oldSnapshots.length > 0) {
			const scrollEl = view.bodyEl?.querySelector<HTMLElement>(
				IOTO_TASK_SCROLL_SELECTOR,
			);
			if (scrollEl) {
				const plan = prepareSwapTransition({
					scrollEl,
					oldSnapshots,
					newSnapshots: captureCardSnapshots(
						scrollEl,
						IOTO_TASK_CARD_SELECTOR,
					),
					reducedMotion: false,
				});
				if (plan) {
					const token = ++view.listTransitionToken;
					view.listTransitionCleanup = () => plan.cancel();
					scheduleListPlay(view, () => {
						if (
							token !== view.listTransitionToken ||
							!scrollEl.isConnected
						) {
							plan.cancel();
							return;
						}
						plan.play();
					});
				}
			}
		}
	} finally {
		view.isRendering = false;
	}

	// 命令就绪补偿：本次渲染若因 ioto-settings 命令尚未注册而漏建卡片动作按钮，
	// 挂一趟短轮询，命令出现后补建；命令已齐则幂等 no-op（[[Research-20261008-122828]] 方案 A）。
	view.awaitCommandReadiness();
}

/**
 * 双 `requestAnimationFrame` 后执行 `callback`（等布局 + 异步
 * `MarkdownRenderer` 落字稳定再起播）。起点态已由 `prepareSwapTransition`
 * 同步定格，因此等待期间用户看到的是「起点态」而非最终态。
 */
export function scheduleListPlay(
	view: TaskViewHost,
	callback: () => void,
): void {
	const raf = (cb: FrameRequestCallback): number =>
		window.requestAnimationFrame(cb);
	raf(() => raf(callback));
}

/** 立即作废并收尾上一场进出场动画（幂等；无动画时为 no-op）。 */
export function cancelListTransition(view: TaskViewHost): void {
	view.listTransitionToken += 1;
	view.listTransitionCleanup?.();
	view.listTransitionCleanup = null;
}

/** 系统「减弱动态效果」偏好：JS 侧预判（CSS 侧另有兜底）。 */
export function prefersReducedMotion(view: TaskViewHost): boolean {
	return (
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ===
		true
	);
}

/**
 * 只按 `selectedLine` 回填 `.is-selected`，不抢焦点。
 * 过滤 / 折叠后选中卡可能已不在 DOM（[[Plan-20261004-110845]] §5.5）：
 * 退化为「第一张可见卡」或 `null`，避免悬空选中。
 *
 * 方案 A（[[Discuss-20261008-173935]]）：放大态恒为单卡编辑面，`zoomLine` 非空时
 * 整体跳过——内部 `selectedLine` 仍保留（AI 条目来源需要），但不再回填可见选中类。
 */
export function syncSelectionClass(view: TaskViewHost): void {
	const line = view.selectedLine;
	if (line === null) {
		return;
	}
	if (view.zoomLine !== null) {
		return;
	}

	const cardEl = queryCard(view, line);
	if (cardEl) {
		cardEl.addClass('is-selected');
		return;
	}

	const fallback = pickEdgeLine(
		collectCardLines(view.contentEl),
		'first',
	);
	view.selectedLine = fallback;
	if (fallback !== null) {
		queryCard(view, fallback)?.addClass('is-selected');
	}
}

/** 外部 vault.modify 触发重读重绘；编辑期间由 editingLine / continuationLine 抑制。 */
export async function reloadFromVault(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	// 编辑期间忽略外部写入，避免编辑器被重绘冲掉（只挡重绘，不挡写盘）。
	if (view.editingLine !== null || view.continuationLine !== null) {
		return;
	}

	const content = await view.app.vault.cachedRead(file);
	if (content === view.lastLoadedText) {
		return;
	}

	view.data = content;
	view.lastLoadedText = content;
	view.renderNote(content);
}

/**
 * 卡片动作区编辑控制器（渲染层通过回调调用）。读实时 `view.xxx` 值；
 * 两个 ioto-settings 命令按钮仅在「支持内联编辑」+「命令已注册」时注入。
 */
export function buildEditingController(view: TaskViewHost): TaskNoteEditing {
	// 箭头函数读实时值，供下面的 getter 转发（不写 `const self = this`）
	const readSelected = (): number | null => view.selectedLine;
	const readDeletePending = (): boolean => view.pendingDeleteLine !== null;
	// 🔴 对象字面量里的 `this` 指向对象本身，故必须走箭头读取器。
	const readEditingLine = (): number | null => view.editingLine;
	const readZoomLine = (): number | null => view.zoomLine;
	// 卡片动作区按钮：仅在「支持内联编辑」且「目标命令已注册」时才注入，
	// 缺省即渲染层隐藏按钮（Q5：只读 / ioto-settings 未启用 → 隐藏）。
	const inlineEdit = view.supportsInlineEdit();
	const canInsertLink = view.canDispatch(INSERT_OUTGOING_LINK_COMMAND_ID);
	const canEditControls = view.canDispatch(EDIT_ITEM_CONTROLS_COMMAND_ID);
	return {
		enabled: inlineEdit,
		// 🔴 必须是 getter：渲染层在 click / keydown 闭包里读实时值，
		// 建成普通属性会捕获构建那一刻的旧值，「第二次点击进编辑」就判不出来了。
		get selectedLine() {
			return readSelected();
		},
		select: (line) => {
			view.select(line);
		},
		// 选择态删除入口改语义分派：首按进确认态，同一行再次触发才真删
		//（[[Plan-20261005-141853]] 步骤 2）。确认按钮 / 二次 Delete 都走这里。
		delete: (line) => {
			void view.requestDelete(line);
		},
		// 取消按钮 / Esc 调用；无 pending 时幂等 no-op。
		cancelDelete: () => {
			view.cancelPendingDelete();
		},
		// 🔴 必须是 getter：渲染层在 keydown 闭包里读实时值（同 selectedLine）。
		get deletePending() {
			return readDeletePending();
		},
		// 🔴 必须是 getter：关键词过滤读实时值，供「编辑中的卡无条件保留」兜底。
		get editingLine() {
			return readEditingLine();
		},
		get zoomLine() {
			return readZoomLine();
		},
		beginEdit: (line) => {
			void view.beginEdit(line);
		},
		beginContinuationEdit: (line) => {
			void view.beginContinuationEdit(line);
		},
		insertSibling: (line) => {
			void view.insertSibling(line);
		},
		indent: (line, delta) => {
			void view.indentSelected(line, delta);
		},
		toggleTask: (line, cardEl) => {
			void view.toggleTask(line, cardEl);
		},
		// 🔴 派发前**不** commitEdit：两个命令都依赖「命令同步段仍处编辑态」
		// （出链读 activeEditor?.editor，条目控制走 item-control-bridge 的
		// getItemControlHost，要求 editingLine / editingHandle 存活）。
		// 按钮已由 embedded-editor 捕获阶段保焦，命令可直接派发。
		...(inlineEdit && canInsertLink
			? {
					insertOutgoingLink: () =>
						view.dispatchCommand(INSERT_OUTGOING_LINK_COMMAND_ID),
				}
			: {}),
		...(inlineEdit && canEditControls
			? {
					editItemControls: () =>
						view.dispatchCommand(EDIT_ITEM_CONTROLS_COMMAND_ID),
				}
			: {}),
		...(inlineEdit
			? {
					toggleZoom: (line: number) => {
						view.toggleZoomCard(line);
					},
					focusZoomEditor: (line: number) => {
						view.focusZoomEditor(line);
					},
				}
			: {}),
	};
}

/**
 * 卡片正文 / Section markdown 里双链的接管方。
 *
 * 渲染层只产 HTML，点击与 hover 是视图自己的职责
 * （[[Research-20261004-001616]] §四）。
 */
export function buildLinkController(view: TaskViewHost): TaskNoteLinks {
	return {
		open: (linktext, newLeaf) => {
			const sourcePath = view.file?.path ?? '';
			void (async () => {
				// 编辑态点**别的卡片**的链接：mousedown 的 blur 已提交过一次，
				// 这里是幂等兜底；成功后只 `refreshCard`，不整树重建，
				// 被点的 `<a>` 仍在 DOM 上，本次点击照常派发。
				await view.commitEdit();
				await view.app.workspace.openLinkText(
					linktext,
					sourcePath,
					// 核心同款叶子类型：'tab' / 'split' / 'window'，或 false = 当前叶子
					newLeaf,
				);
			})();
		},
		hover: (event, linktext, targetEl) => {
			view.app.workspace.trigger('hover-link', {
				event,
				source: IOTO_TASK_VIEW_HOVER_SOURCE_ID,
				hoverParent: view.hoverPreviewParent,
				targetEl,
				linktext,
				sourcePath: view.file?.path ?? '',
			} satisfies TaskHoverPreviewPayload);
		},
	};
}

/**
 * 渲染层的「叶子类型模块」：只放被渲染子模块反向引用的纯类型。
 *
 * 设计意图（Plan-20261009-142035 §七 C-1）：这些类型原先定义在 `render-note.ts`，
 * 而 `render-note.ts` 又值导入 `render-sections.ts` —— 于是「子模块 → render-note」
 * 的类型边是承重墙，一旦改成值导入即成环。下沉到零业务出边的叶子后，反向边消失，
 * `import type` 不再是维持无环的隐式不变量。
 *
 * 本文件**只依赖 `obsidian` 的类型**，不得引入任何本仓模块（保持叶子）。
 */
import type { PaneType } from 'obsidian';

/** 编辑交互回调（由 `IOTOTaskView` 注入；只读态 `enabled = false`）。 */
export interface TaskNoteEditing {
	readonly enabled: boolean;
	/**
	 * 当前处于**选择态**的行号（0 基文件行号）。
	 *
	 * 🔴 必须是 getter：渲染层在 click / keydown 闭包里读实时值；若建成普通属性
	 * 会捕获构建那一刻的旧值，导致「第二次点击进编辑」永远判不出来
	 * （[[Plan-20261003-194909]] §5.1a）。
	 */
	readonly selectedLine: number | null;
	/** 只选中（`idle → selected`）：加类 + 聚焦，不建编辑器 */
	select(line: number): void;
	/** 删除该行，并把选择落到相邻卡片（`selected → selected/null`） */
	delete(line: number): void;
	/**
	 * 取消「待删除确认」瞬态（pending 时有效）；缺省 = 该能力不可用。
	 * 供取消按钮 / `Esc` 调用（[[Plan-20261005-141853]] 步骤 6）。
	 */
	cancelDelete?(): void;
	/**
	 * 是否正处于「待删除确认」瞬态（getter，读实时值，供 keydown 路由）。
	 *
	 * 🔴 必须是 getter：渲染层在 keydown 闭包里读实时值；普通属性会捕获构建那一刻
	 * 的旧值，pending 判定永远失效（同 `selectedLine`）。
	 */
	readonly deletePending?: boolean;
	/**
	 * 关键词过滤里**需无条件保留的卡片行号**（getter，读实时值）；无则 `null`。
	 *
	 * = 标题正在编辑的行，或续行正在编辑时拥有该续行的任务行（真源
	 * `keepVisibleCardLine`）。渲染层只拿结果、不判编辑器种类——`editingLine`
	 * 这个名字装 `continuationLine` 的值会制造又一处隐式语义
	 * （[[Plan-20261010-070400]] B4）。与 `selectedLine`（仅选中）区分，避免把
	 * 「仅选中、未编辑」的卡也保留（[[Plan-20261006-161121]] §2.2e）。
	 */
	readonly keepVisibleLine?: number | null;
	/** 进入卡片正文内联编辑（同时会提交上一张正在编辑的卡片） */
	beginEdit(line: number): void;
	/**
	 * 点续行块：进入该卡续行的就地多行编辑（会先提交正在编辑的标题 / 其它续行）。
	 */
	beginContinuationEdit(line: number): void;
	/**
	 * 选择态 `Shift+Enter`：在 `line` 下方插入一张同级空卡片，并进入其编辑态。
	 * 与编辑态 `Enter` 的「新建同级」同源，只是不拆分当前正文。
	 */
	insertSibling(line: number): void;
	/**
	 * 选择态 `Tab` / `Shift+Tab`：对 `line` 做 ±1 级缩进（`delta = +1 / -1`）。
	 * 与编辑态 `onIndent` 同源（`setTaskIndent`），只是不进入编辑器。
	 */
	indent(line: number, delta: number): void;
	/** 3a 勾选：点 checkbox ↔ 行内 `[ ]` / `[x]`（乐观更新由调用方负责） */
	toggleTask(line: number, cardEl: HTMLElement): void;
	/**
	 * 派发「插入出链」命令（`ioto-settings:ioto-insert-outgoing-link`）。
	 * **缺省 = 按钮不渲染**：天然表达「命令未注册 / 只读态 → 隐藏按钮」
	 * （[[Plan-20261005-111411]] §三 步骤 1，坑 E）。
	 */
	insertOutgoingLink?(line: number): void;
	/**
	 * 派发「编辑条目控制」命令（`ioto-settings:ioto-edit-item-controls`）。
	 * **缺省 = 按钮不渲染**（同上）。
	 */
	editItemControls?(line: number): void;
	/**
	 * 当前处于「聚焦放大」态的文件行号（getter，读实时值）；非放大态 `null`。
	 * 与 `keepVisibleLine` 同源——放大只在卡片编辑态存在，故通常等于它。
	 */
	readonly zoomLine?: number | null;
	/**
	 * 切换「聚焦放大」：对同一行再次调用即缩小（幂等，纯 DOM 开关，不重绘）。
	 * **缺省 = 按钮不渲染**（只读 / 不支持内联编辑时不显示放大按钮）。
	 */
	toggleZoom?(line: number): void;
	/**
	 * 右键菜单：给该行加 / 去 `#ioto/pin`（[[Plan-20261023-104335]] §4.8）。
	 * **缺省 = 菜单项置灰**（只读 / 不支持内联编辑时不可写，但入口仍保留）。
	 */
	toggleTaskPin?(line: number): void;
	/** 右键菜单：给该行加 / 去 `#ioto/repeat`（同上）。 */
	toggleTaskRepeat?(line: number): void;
	/**
	 * 右键菜单：给该行创建任务副本（[[Plan-20261023-145916]] §5.4）。
	 * **缺省 = 菜单项置灰**（只读 / 不支持内联编辑时不可写，但入口仍保留）。
	 */
	duplicateTask?(line: number): void;
	/**
	 * 放大态点击卡片：把焦点交还内嵌编辑器（[[Discuss-20261008-173935]] 方案 A）。
	 * 放大卡点击一律走这里——不走「未选中 → 先选中」两段式，也不回落选中态。
	 * **缺省 = 放大不可用**（只读 / 不支持内联编辑时不显示放大按钮）。
	 */
	focusZoomEditor?(line: number): void;
	/**
	 * 当前「只看本节」聚焦的 Section 起始行（getter，读实时值）；未聚焦 `null`。
	 *
	 * 与 `zoomLine`（卡片放大）是两层：节聚焦是**布局态**，卡片放大是更内层的
	 * 交互态（[[Research-20261019-131228]] §2.1）。渲染层据此决定放大 / 缩小图标。
	 */
	readonly sectionZoomLine?: number | null;
	/**
	 * 切换「只看本节」：同一节再次调用即缩小（幂等，纯 DOM 开关，不重绘）。
	 * **缺省 = 按钮不渲染**（只读 / 不支持内联编辑时不显示放大按钮）。
	 */
	toggleSectionZoom?(startLine: number): void;
	/** 退出「只看本节」（供放大按钮自身的 `Esc` 局部路径调用）。 */
	exitSectionZoom?(): void;
	/**
	 * 点 Section 头部「编辑本节内容」：进入该节**正文**源码编辑（标题行之下）。
	 * 参数是该 Section 的 `startLine`（不含 `NoteSection`，保持叶子模块零业务出边）。
	 * **缺省 = 按钮不渲染**（只读 / 不支持内联编辑时不显示编辑按钮）。
	 */
	editSection?(startLine: number): void;
	/**
	 * 双击标题 / 点标题右缘铅笔：进入该节标题的单行就地编辑。
	 * **缺省 = 不可用**（只读 / 不支持内联编辑时不挂事件、不建铅笔）。
	 */
	editSectionTitle?(startLine: number): void;
	/**
	 * 点 Section 头部「删除本节」：二次确认后整块删除（含嵌套子标题与任务）。
	 * `title` 仅作兜底文案——实现会按 `startLine` 从当前 `data` 重新解析标题，
	 * 避免改名后仍用渲染闭包里的旧标题。
	 * **缺省 = 删除按钮不渲染**（只读 / 不支持内联编辑）。
	 */
	deleteSection?(startLine: number, title: string): void;
	/**
	 * 点 Section 头部「关闭」：退出该节编辑（**保存并退出**，复用幂等的
	 * `commitSectionEdit`）。参数是该 Section 的 `startLine`（渲染层只回传它，
	 * 不做真源判断）。**缺省 = 关闭按钮不渲染**（只读 / 不支持内联编辑）。
	 */
	closeSection?(startLine: number): void;
	/**
	 * 点 Section 列表底部「新增 Section」加号：文末追加同级标题块并进入该节
	 * 编辑态。**缺省 = 加号不渲染**（只读 / 不支持内联编辑）；渲染层另按
	 * 「只显示任务」过滤开关决定显隐。
	 */
	addSection?(): void;
}

/**
 * Section 拖拽排序回调（由 `IOTOTaskView` 注入）。
 *
 * 渲染层只负责在每个顶层标题块 header 建一个 grip 按钮并调用 `attachHandle`；
 * 手势判定（鼠标直拖 / 触摸长按再拖）、落点命中与写盘编排全部由手势模块接管。
 * **缺省 = grip 不渲染**（只读 / 「只显示任务」态）。
 */
export interface TaskSectionDrag {
	attachHandle(
		handleEl: HTMLElement,
		sectionEl: HTMLElement,
		scrollEl: HTMLElement,
	): void;
}

/**
 * 任务卡片拖拽排序回调（由 `IOTOTaskView` 注入）。
 *
 * 渲染层只负责在每张非编辑态卡片上建一个 grip 按钮并调用 `attachHandle`；
 * 手势判定（鼠标直拖 / 触摸长按再拖）、任务卡 / 章节落点命中与写盘编排全部由
 * 手势模块接管。**缺省 = grip 不渲染**（只读 / 过滤 / 搜索态）。
 */
export interface TaskCardDrag {
	attachHandle(
		handleEl: HTMLElement,
		cardEl: HTMLElement,
		scrollEl: HTMLElement,
	): void;
}

/**
 * 续写区折叠控制器（由 `IOTOTaskView` 注入；缺省 = 全展开且不渲染箭头）。
 *
 * 只做「查状态 / 切换状态」两件事：切换后由实现把结果写回该容器（纯 DOM 类 +
 * aria，**不重绘**）。缺省语义让旧调用与单测零差异
 * （[[Plan-20261022-232148]] §0-8）。
 */
export interface TaskContinuationFold {
	isCollapsed(key: string): boolean;
	/** 切换并把结果写回该容器（纯 DOM 类 + aria；不重绘）。 */
	toggle(key: string, continuationEl: HTMLElement): void;
}

/** 链接交互回调（由 `IOTOTaskView` 注入；只读态同样生效）。 */
export interface TaskNoteLinks {
	/** 打开双链：`newLeaf` = 核心同款叶子类型（`Keymap.isModEvent` 的结果） */
	open(linktext: string, newLeaf: PaneType | boolean): void;
	/**
	 * 打开外部链接（`http(s):` / `file:` / 自定义 scheme）。
	 *
	 * 核心只在 Markdown View 的预览容器上装了 `a.external-link` 委托，自定义视图
	 * 拿不到；不接管就会落到 `<a target="_blank">` 的默认导航，被 Electron 拦成
	 * `Not allowed to load local resource`（`file:` 必现）。实现走 `window.open`
	 * 交由 Electron 主进程路由（与核心 `onExternalLinkClick` 同款）。
	 *
	 * 实现会先经 `toExternalOpenUrl()` 做**跨平台归一化**：把 Windows 裸盘符路径
	 * `C:\…` 补成 `file:///C:/…`（[[Plan-20261012-192019]]），正常 URL 原样透传。
	 */
	openExternal(href: string): void;
	/** 触发核心 hover 预览（修饰键判断交给核心） */
	hover(event: MouseEvent, linktext: string, targetEl: HTMLElement): void;
}

/** 视图过滤开关（[[Plan-20261004-110845]] 批次 B/C）。真源在笔记 frontmatter。 */
export interface TaskNoteFilters {
	/** ① 只显示任务区块：无任务列表的顶层 Section 整块隐藏 */
	onlyTaskBlocks: boolean;
	/** ② 只显示未完成任务：隐藏 `[x]` 卡片（空 Section 仍保留） */
	onlyPending: boolean;
	/** ③ 只显示最近任务：每个 Section 只保留末尾 N 个顶级任务（含其子任务） */
	recentOnly: boolean;
}

/**
 * IOTOTask 视图导出为图片的管线（[[Plan-20261006-102142]] §2.2，路线依据 [[Discuss-20261006-101334]]，
 * 做法移植自 text-popup 的已验证实现 [[Report-20260927-074958]] —— 跨插件只复用做法、代码在本插件内重写）。
 *
 * 分两层，与仓库既有「纯函数层 + DOM 层」做法同源：
 * - 纯函数层（文件名 / 倍率钳制 / 画布上限 / 背景解析）：不碰 DOM，单测主战场；
 * - DOM/IO 层（光栅化 / 剪贴板 / 落盘）：真机验证。
 *
 * 技术路线 = `html-to-image`（DOM 克隆 → 内联计算样式 → `foreignObject` 光栅化）。
 * **排除** Electron `capturePage`（只拍视口、无长图、帧滞后）与 CDP `captureScreenshot`
 * （`debugger.attach` 常被占用），理由见 [[Discuss-20261006-101334]] §二。
 *
 * 🔴 非破坏性：`html-to-image` 的 `style` 选项只作用于**克隆出来的根节点**，实时 DOM、
 * 滚动位置、选中态都不受影响（[[Plan-20261006-102142]] 三.7）。
 */

import { toCanvas } from 'html-to-image';
import type { App } from 'obsidian';

export const EXPORT_SCALE_MIN = 1;
export const EXPORT_SCALE_MAX = 4;
export const EXPORT_SCALE_STEP = 0.5;
/** 2×：主流高分屏像素密度，文字在高倍下不发糊（[[Discuss-20261006-101334]] §三 补充）。 */
export const DEFAULT_EXPORT_SCALE = 2;

/** 出图四周的留白（CSS px）；各倍率下乘过倍率再加，视觉留白一致。 */
export const EXPORT_PADDING = 24;

/**
 * 页尾固定的品牌标语：**全语言共用，刻意不进 `lang/locale`**（需求要求各语言一致，
 * [[Discuss-20261008-091032]] §2.2）。照抄原文，`-` 两侧各一个空格、词首大写都不要「顺手规范化」，
 * 以便单测逐字节断言。
 */
export const EXPORT_FOOTER_SLOGAN =
	'IOTO - Your Super Utility Vehicle To Explore The Knowledge Land';

/** 页尾标语基准字号（CSS px）。 */
const FOOTER_FONT_SIZE = 13;
/** 页尾标语窄图自适应时的最小字号下限（CSS px），见 `fitFontSize`。 */
const FOOTER_FONT_SIZE_MIN = 9;
/** 页尾标语不透明度：弱于正文、略强于页眉里 `0.65` 的日期行（[[Discuss-20261008-091032]] §2.1）。 */
const FOOTER_ALPHA = 0.7;

/** canvas 单边硬上限（px）。 */
export const CANVAS_MAX_SIDE = 16384;
/** canvas 总面积硬上限（px²，约 2.68 亿）。 */
export const CANVAS_MAX_AREA = 268_000_000;

/** 文件名里不允许的字符（Windows / macOS 的公共禁区）。 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 笔记名为空时的兜底名（与 Obsidian 新建笔记的 `Untitled` 同口径）。 */
const UNTITLED = 'Untitled';

/** 导出文件名里的固定标识段，用于与「导出 Markdown 正文」区隔。 */
const TASK_VIEW_LABEL = '任务视图';

/** 深 / 浅色主题下的最终兜底底色（必须**不透明**，见 §三.3）。 */
const FALLBACK_DARK = '#1e1e1e';
const FALLBACK_LIGHT = '#ffffff';

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * 导出倍率钳制：非数 / 越界回落默认值，再按 0.5 步长取整（值恒落在步长网格上）。
 */
export function clampExportScale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_EXPORT_SCALE;
	}
	const clamped = clamp(value, EXPORT_SCALE_MIN, EXPORT_SCALE_MAX);
	return Math.round(clamped / EXPORT_SCALE_STEP) * EXPORT_SCALE_STEP;
}

/**
 * `任务笔记名-任务视图-YYYYMMDD-HHmmss.png`：笔记名在前便于回看溯源，时间戳保证连导不覆盖。
 * 非法字符替换成 `-`（不删：删掉会让两个不同的名字撞在一起），首尾空白与末尾的点一并去掉。
 */
export function buildExportFileName(noteBasename: string, at: Date): string {
	const base = (noteBasename ?? '')
		.replace(ILLEGAL_NAME_CHARS, '-')
		.trim()
		.replace(/\.+$/, '');
	const name = base === '' ? UNTITLED : base;
	const stamp =
		`${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}` +
		`-${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
	return `${name}-${TASK_VIEW_LABEL}-${stamp}.png`;
}

/**
 * 判定一个**已解析**的 CSS 颜色是否不透明。
 *
 * 透明底 + 半透明卡片发到聊天软件会变黑（[[Discuss-20261006-101334]] §四.3），所以导出必须
 * 压在实底上。`transparent` 与 `rgba(r,g,b,0)` / `rgb(r g b / 0)` 都算透明。
 */
export function isOpaqueBackground(color: string | null | undefined): boolean {
	if (typeof color !== 'string') {
		return false;
	}
	const value = color.trim().toLowerCase();
	if (value === '' || value === 'transparent' || value === 'none') {
		return false;
	}
	// cssrgb：`rgba(0, 0, 0, 0)` 或 `rgb(0 0 0 / 0%)`
	const alphaMatch = /(?:rgba?\((?:[^)]*?)[,\s/]+([\d.]+%?)\s*\))/.exec(value);
	if (alphaMatch && alphaMatch[1] !== undefined) {
		const raw = alphaMatch[1];
		const alpha = raw.endsWith('%')
			? Number.parseFloat(raw) / 100
			: Number.parseFloat(raw);
		if (Number.isFinite(alpha) && alpha <= 0) {
			return false;
		}
	}
	return true;
}

/**
 * 从一串候选背景色里挑第一个**不透明**的；全透明则回落到主题实底
 * （[[Plan-20261006-102142]] §2.2 的 `resolveExportBackground`，抽成纯函数以便零 DOM 单测）。
 */
export function pickOpaqueBackground(
	candidates: Array<string | null | undefined>,
	isDarkTheme: boolean,
): string {
	for (const candidate of candidates) {
		if (isOpaqueBackground(candidate)) {
			return (candidate as string).trim();
		}
	}
	return isDarkTheme ? FALLBACK_DARK : FALLBACK_LIGHT;
}

/**
 * 解析导出用的**不透明**底色：优先视图根自身的 `background-color`，否则沿祖先找到第一个
 * 不透明背景；最终兜底主题实底。玻璃主题的 Aurora 挂在视图根 `::before`，天然不参与解析
 * （[[Plan-20261006-102142]] §三.2）。
 */
export function resolveExportBackground(viewRootEl: HTMLElement): string {
	const candidates: Array<string | null | undefined> = [];
	let node: HTMLElement | null = viewRootEl;
	let guard = 0;
	while (node && guard < 32) {
		const style = node.ownerDocument.defaultView?.getComputedStyle(node);
		candidates.push(style?.backgroundColor ?? null);
		node = node.parentElement;
		guard += 1;
	}
	const doc = viewRootEl.ownerDocument;
	const isDark =
		doc.body?.classList.contains('theme-dark') === true ||
		doc.documentElement.classList.contains('theme-dark');
	return pickOpaqueBackground(candidates, isDark);
}

/**
 * 在「全高 × 期望倍率」超出 canvas 硬上限时自动下调倍率（下限 1），避免 `toBlob` 静默失败
 * （[[Plan-20261006-102142]] §三.5）。
 */
export function computeCanvasScaleLimit(
	cssWidth: number,
	cssHeight: number,
	desiredScale: number,
): number {
	const width = Math.max(1, cssWidth);
	const height = Math.max(1, cssHeight);
	const sideLimit = CANVAS_MAX_SIDE / Math.max(width, height);
	const areaLimit = Math.sqrt(CANVAS_MAX_AREA / (width * height));
	const limit = Math.min(desiredScale, sideLimit, areaLimit);
	return Math.max(EXPORT_SCALE_MIN, limit);
}

/**
 * 已知**拍不到**的内容（iframe 跨文档；Canvas minimap 由核心绘制）。
 * 不阻断出图，交给调用方补一条「部分图片未能拍入」的提示（[[Discuss-20261006-101334]] §四.5）。
 */
const UNCAPTURABLE_SELECTOR = 'iframe, .canvas-minimap';

export function hasUncapturableContent(rootEl: Element): boolean {
	return rootEl.querySelector(UNCAPTURABLE_SELECTOR) !== null;
}

// ——————————————————————————————————————————————————————————————
// DOM / IO 层
// ——————————————————————————————————————————————————————————————

export interface CaptureResult {
	canvas: HTMLCanvasElement;
	/** 视图中存在已知拍不到的内容（iframe / Canvas minimap），不阻断出图。 */
	partial: boolean;
	/** 因 canvas 硬上限被封顶了高度（极长清单），不阻断出图。 */
	heightCapped: boolean;
	/** 实际使用的倍率（可能因 canvas 上限被下调）。 */
	scale: number;
}

/** 视图根类名（离屏宿主复刻它，才能拿到同一套祖先选择器与容器查询上下文）。 */
const VIEW_ROOT_SELECTOR = '.ioto-task-view';

/** 只在交互中出现的瞬时态类，导出前从**克隆**上摘掉（不碰实时 DOM）。 */
const TRANSIENT_CLASSES = [
	'is-selected',
	'is-pending-delete',
	'is-zoom-hidden', // 新增：放大时不把「被隐藏的兄弟卡」一起拍进图
	'is-zoomed', // 新增：还原被抬高的高度
];

/** 待删除确认遮罩的类名（整块剔除）。 */
const DELETE_CONFIRM_SELECTOR = '.ioto-task-view__delete-confirm';

/**
 * 把任务视图拍成**一张长图**（按内容全高一次出图，无滚动 / 拼接）。
 *
 * 关键实现口径（实机验证得出，见 [[Report-20261006-102530]]）：
 * 1. **拍离屏克隆，不拍实时 DOM**。`html-to-image` 会把每个节点的**计算样式**（含 `width` /
 *    `height` 的**已用像素值**）内联进克隆，所以克隆**不会**随根节点宽度重新排版 —— 直接把
 *    根节点宽度设成目标宽度只会得到「裁剪」而不是「重排」。因此这里把 `.ioto-task-view__scroll`
 *    深克隆进一个复刻了视图根类名的离屏宿主（`width` 设成目标宽度），让它在真实布局下按目标
 *    宽度重排，再拍克隆。副作用是顺带解决了「瞬时态类入图」与「过渡中间值入图」两个问题，
 *    且实时 DOM、滚动位置、选中态零改动（[[Plan-20261006-102142]] §三.7）。
 * 2. 工具栏是滚动容器的兄弟，天然不入图；玻璃主题的 Aurora 挂在视图根 `::before`，也天然不在图里。
 * 3. `onImageErrorHandler` 让单张图片抓不下来时留空继续出图（§四.5「尽力而为」）。
 */
export async function captureTaskViewCanvas(
	scrollEl: HTMLElement,
	opts: { width: number; desiredScale: number; backgroundColor: string },
): Promise<CaptureResult> {
	const width = Math.max(1, Math.round(opts.width));
	const viewRoot =
		scrollEl.closest<HTMLElement>(VIEW_ROOT_SELECTOR) ?? scrollEl;
	const doc = scrollEl.ownerDocument;
	const host = doc.createElement('div');
	// 复刻视图根类名 + 挂 `is-exporting`（让 `styles.css` 的导出瞬间规则作用在克隆上：抹编辑态
	// 焦点框 / 光标，禁用过渡与动画）。
	host.className = `${viewRoot.className} is-exporting ioto-task-view-export-host`;
	host.setAttribute(
		'style',
		`position:fixed;left:-20000px;top:0;width:${width}px;pointer-events:none;`,
	);
	const clone = scrollEl.cloneNode(true) as HTMLElement;
	// 只动克隆：摘掉只在交互中出现的瞬时态，整块剔除删除确认遮罩。
	for (const cls of TRANSIENT_CLASSES) {
		clone.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
	}
	clone.querySelectorAll(DELETE_CONFIRM_SELECTOR).forEach((el) => el.remove());
	host.appendChild(clone);
	doc.body.appendChild(host);

	try {
		const rawHeight = Math.max(1, Math.round(clone.scrollHeight));
		const scale = clampExportScale(
			computeCanvasScaleLimit(width, rawHeight, opts.desiredScale),
		);
		const maxHeightBySide = Math.floor(CANVAS_MAX_SIDE / scale);
		const maxHeightByArea = Math.floor(
			CANVAS_MAX_AREA / (width * scale * scale),
		);
		const height = Math.min(rawHeight, maxHeightBySide, maxHeightByArea);

		const source = await toCanvas(clone, {
			pixelRatio: scale,
			backgroundColor: opts.backgroundColor,
			width,
			height,
			style: {
				height: `${height}px`,
				overflow: 'visible',
			},
			onImageErrorHandler: () => undefined,
		});

		return {
			canvas: withPadding(source, opts.backgroundColor, scale),
			partial: hasUncapturableContent(clone),
			heightCapped: height < rawHeight,
			scale,
		};
	} finally {
		host.remove();
	}
}

/** 四周加留白（二次合成，不拉伸内容；留白量按设备像素算）。 */
function withPadding(
	source: HTMLCanvasElement,
	backgroundColor: string,
	scale: number,
): HTMLCanvasElement {
	const pad = Math.round(EXPORT_PADDING * scale);
	// 用全局 `createEl` 而不是 `activeDocument.createEl`（后者会 appendChild 到 document 上并抛错）
	const canvas = createEl('canvas');
	canvas.width = source.width + pad * 2;
	canvas.height = source.height + pad * 2;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return source; // 拿不到 2d 上下文就退回原图，总比整张空白好
	}
	ctx.fillStyle = backgroundColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, pad, pad);
	return canvas;
}

/**
 * 解析 `#rgb` / `#rrggbb` / `rgb(r,g,b)` 为分量；解析不了返回 `null`。
 * 只认导出路径上真正会出现的形式（`getComputedStyle` 已把 `color-mix()` 解析成 rgb）。
 */
export function parseCssColor(
	color: string | null | undefined,
): { r: number; g: number; b: number } | null {
	if (typeof color !== 'string') {
		return null;
	}
	const value = color.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
	const digits = hex?.[1];
	if (digits) {
		const expand =
			digits.length === 3
				? digits
						.split('')
						.map((d) => `${d}${d}`)
						.join('')
				: digits;
		return {
			r: Number.parseInt(expand.slice(0, 2), 16),
			g: Number.parseInt(expand.slice(2, 4), 16),
			b: Number.parseInt(expand.slice(4, 6), 16),
		};
	}
	const rgb = /rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/.exec(value);
	if (rgb) {
		return {
			r: Number.parseInt(rgb[1] as string, 10),
			g: Number.parseInt(rgb[2] as string, 10),
			b: Number.parseInt(rgb[3] as string, 10),
		};
	}
	return null;
}

/**
 * 给一个背景色挑可读的文字色（深底给浅字、浅底给深字）。用于可选页眉
 * （[[Plan-20261006-102142]] Q3）—— 不去读主题的文字色，避免依赖主题变量解析。
 */
export function readableTextColor(backgroundColor: string): string {
	const rgb = parseCssColor(backgroundColor);
	if (!rgb) {
		return '#1f1f1f';
	}
	// sRGB 相对亮度（IEC 61966-2-1）
	const luminance =
		(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
	return luminance > 0.55 ? '#1f1f1f' : '#f5f5f5';
}

/** 页眉时间戳：`YYYY-MM-DD HH:mm`。 */
export function formatExportDate(at: Date): string {
	return (
		`${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}` +
		` ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
	);
}

/**
 * 窄图自适应缩字号（[[Discuss-20261008-091032]] Q1-A）：`text` 在 `basePx` 下放不下 `maxWidthPx`
 * 时按线性比例估算目标字号，再循环收敛（度量随字号非线性，故需迭代），下限 `minPx`。
 *
 * 返回恒落在 `[min, base]`；仍放不下时由调用方交给 `fillText` 的 `maxWidth` 去压 —— 尽量少压，
 * 避免整句被横向压扁。`measure(text, sizePx)` 由调用方注入（真实环境包 `ctx.measureText`），
 * 以便纯函数零 DOM 单测。
 */
export function fitFontSize(
	text: string,
	maxWidthPx: number,
	basePx: number,
	minPx: number,
	measure: (text: string, sizePx: number) => number,
): number {
	const min = Math.max(1, minPx);
	const base = Math.max(min, basePx);
	const maxWidth = Math.max(1, maxWidthPx);
	const baseWidth = measure(text, base);
	if (!Number.isFinite(baseWidth) || baseWidth <= maxWidth) {
		return base;
	}
	let size = (base * maxWidth) / baseWidth;
	for (let i = 0; i < 6 && size > min; i += 1) {
		const width = measure(text, size);
		if (!Number.isFinite(width) || width <= maxWidth) {
			return size;
		}
		size = (size * maxWidth) / width;
	}
	return min;
}

/**
 * 可选页眉（[[Plan-20261006-102142]] Q3，默认关闭）：在内容图上方合成一条「文件名 + 日期」带。
 * 走 canvas 二次合成而不是往实时 DOM 注入节点，零 DOM 改动、零闪烁。
 */
export function composeExportHeader(
	source: HTMLCanvasElement,
	opts: {
		title: string;
		at: Date;
		backgroundColor: string;
		textColor: string;
		scale: number;
	},
): HTMLCanvasElement {
	const scale = clampExportScale(opts.scale);
	const pad = Math.round(EXPORT_PADDING * scale);
	const titleSize = Math.round(18 * scale);
	const metaSize = Math.round(12 * scale);
	const gap = Math.round(6 * scale);
	const topPad = Math.round(14 * scale);
	const bottomPad = Math.round(14 * scale);
	const headerHeight = topPad + titleSize + gap + metaSize + bottomPad;

	const canvas = createEl('canvas');
	canvas.width = source.width;
	canvas.height = source.height + headerHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return source; // 拿不到 2d 上下文就退回无页眉图
	}
	ctx.fillStyle = opts.backgroundColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.textBaseline = 'alphabetic';
	const maxWidth = Math.max(1, canvas.width - pad * 2);

	ctx.fillStyle = opts.textColor;
	ctx.font = `600 ${titleSize}px sans-serif`;
	ctx.fillText(opts.title, pad, topPad + titleSize, maxWidth);

	ctx.globalAlpha = 0.65;
	ctx.fillStyle = opts.textColor;
	ctx.font = `${metaSize}px sans-serif`;
	ctx.fillText(formatExportDate(opts.at), pad, topPad + titleSize + gap + metaSize, maxWidth);
	ctx.globalAlpha = 1;

	ctx.drawImage(source, 0, headerHeight);
	return canvas;
}

/**
 * 可选页尾（[[Discuss-20261008-091032]]，默认关闭）：在内容图**下方**合成一条品牌标语带
 * （`EXPORT_FOOTER_SLOGAN` 固定英文、全语言一致，底部居中）。与 `composeExportHeader` 完全同构 ——
 * 只在内容图一端追加、不碰实时 DOM、零闪烁；两者独立可同时开。
 *
 * 窄图放不下时先按 Q1-A 自适应缩字号（下限 `FOOTER_FONT_SIZE_MIN`），仍放不下才交给 `fillText`
 * 的 `maxWidth` 压缩，避免单纯把整句字形横向压扁。
 */
export function composeExportFooter(
	source: HTMLCanvasElement,
	opts: { backgroundColor: string; textColor: string; scale: number },
): HTMLCanvasElement {
	const scale = clampExportScale(opts.scale);
	const pad = Math.round(EXPORT_PADDING * scale);
	const topPad = Math.round(14 * scale);
	const baseTextSize = Math.round(FOOTER_FONT_SIZE * scale);
	const bottomPad = Math.round(14 * scale);
	const footerHeight = topPad + baseTextSize + bottomPad;

	const canvas = createEl('canvas');
	canvas.width = source.width;
	canvas.height = source.height + footerHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return source; // 拿不到 2d 上下文就退回无页尾图
	}
	ctx.fillStyle = opts.backgroundColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, 0, 0);

	const maxWidth = Math.max(1, canvas.width - pad * 2);
	const textSize = fitFontSize(
		EXPORT_FOOTER_SLOGAN,
		maxWidth,
		baseTextSize,
		Math.round(FOOTER_FONT_SIZE_MIN * scale),
		(text, sizePx) => {
			ctx.font = `${sizePx}px sans-serif`;
			return ctx.measureText(text).width;
		},
	);

	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.globalAlpha = FOOTER_ALPHA;
	ctx.fillStyle = opts.textColor;
	ctx.font = `${textSize}px sans-serif`;
	ctx.fillText(
		EXPORT_FOOTER_SLOGAN,
		canvas.width / 2,
		source.height + topPad + textSize,
		maxWidth,
	);
	ctx.globalAlpha = 1;
	return canvas;
}

/** `canvas.toBlob` 的 Promise 版；浏览器给不出 blob 时直接抛错，由调用方提示。 */
export function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
			mime,
		);
	});
}

/** 恒写 PNG —— Chromium 的异步剪贴板写 `image/jpeg` 会被 `NotAllowedError` 拒。失败抛错，不静默。 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
	const mime = 'image/png';
	const blob = await canvasToBlob(canvas, mime);
	await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
}

/**
 * 写进库内附件目录：路径由 `getAvailablePathForAttachment` 生成 —— 遵守用户的「附件默认位置」
 * 设置并自动去重（[[Discuss-20261006-101334]] §三.5）。
 */
export async function saveCanvasToVault(
	app: App,
	canvas: HTMLCanvasElement,
	filename: string,
	opts: { sourcePath?: string },
): Promise<string> {
	const blob = await canvasToBlob(canvas, 'image/png');
	const buffer = await blob.arrayBuffer();
	const path = await app.fileManager.getAvailablePathForAttachment(
		filename,
		opts.sourcePath,
	);
	await app.vault.createBinary(path, buffer);
	return path;
}

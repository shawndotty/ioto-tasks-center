/**
 * `export.ts` 纯函数层的行为用例（[[Plan-20261006-102142]] §2.8）。
 *
 * 守三条对外承诺：
 * 1. 任何越界 / 非法值都回落成可用值（导出设置不会带 `undefined` / `NaN` 进截图库）；
 * 2. 导出底**恒为不透明**（半透明底 + 透明 PNG 在聊天软件里会发黑）；
 * 3. 超长清单触 canvas 硬上限时**自动降倍率**，永不静默失败。
 *
 * 刻意没测：`captureTaskViewCanvas` / `copyCanvasToClipboard` / `saveCanvasToVault` 这些
 * DOM/IO 层（要真实 DOM、剪贴板与 vault），按计划走真机验证。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const {
	buildExportFileName,
	clampExportScale,
	composeExportFooter,
	computeCanvasScaleLimit,
	fitFontSize,
	formatExportDate,
	hasUncapturableContent,
	isOpaqueBackground,
	parseCssColor,
	pickOpaqueBackground,
	readableTextColor,
	CANVAS_MAX_SIDE,
	DEFAULT_EXPORT_SCALE,
	EXPORT_FOOTER_SLOGAN,
	EXPORT_SCALE_MAX,
	EXPORT_SCALE_MIN,
} = await jiti.import('../src/export.ts');

/* ------------------------------------------------------------------ *
 * 倍率钳制
 * ------------------------------------------------------------------ */

test('clampExportScale：非数回落默认 2×', () => {
	assert.equal(clampExportScale(undefined), DEFAULT_EXPORT_SCALE);
	assert.equal(clampExportScale(Number.NaN), DEFAULT_EXPORT_SCALE);
	assert.equal(clampExportScale('3'), DEFAULT_EXPORT_SCALE);
});

test('clampExportScale：越界夹到 [1, 4]', () => {
	assert.equal(clampExportScale(0), EXPORT_SCALE_MIN);
	assert.equal(clampExportScale(-5), EXPORT_SCALE_MIN);
	assert.equal(clampExportScale(9), EXPORT_SCALE_MAX);
});

test('clampExportScale：按 0.5 步长取整，值落在步长网格上', () => {
	assert.equal(clampExportScale(1.3), 1.5);
	assert.equal(clampExportScale(2.2), 2);
	assert.equal(clampExportScale(3.4), 3.5);
});

/* ------------------------------------------------------------------ *
 * 文件名
 * ------------------------------------------------------------------ */

test('buildExportFileName：笔记名 + 任务视图 + 时间戳', () => {
	const at = new Date(2026, 9, 6, 10, 15, 30); // 2026-10-06 10:15:30
	assert.equal(
		buildExportFileName('任务视图另存为图片功能', at),
		'任务视图另存为图片功能-任务视图-20261006-101530.png',
	);
});

test('buildExportFileName：非法字符替换成 -，不整段删除', () => {
	const at = new Date(2026, 0, 2, 3, 4, 5);
	assert.equal(
		buildExportFileName('a/b:c*d?"e<f>g|h', at),
		'a-b-c-d--e-f-g-h-任务视图-20260102-030405.png',
	);
});

test('buildExportFileName：空名 / 纯空白回落 Untitled，末尾点去掉', () => {
	const at = new Date(2026, 0, 2, 3, 4, 5);
	assert.equal(
		buildExportFileName('   ', at),
		'Untitled-任务视图-20260102-030405.png',
	);
	assert.equal(
		buildExportFileName('name...', at),
		'name-任务视图-20260102-030405.png',
	);
});

/* ------------------------------------------------------------------ *
 * 背景不透明性
 * ------------------------------------------------------------------ */

test('isOpaqueBackground：透明 / 零 alpha 判否，其余判真', () => {
	assert.equal(isOpaqueBackground('transparent'), false);
	assert.equal(isOpaqueBackground(''), false);
	assert.equal(isOpaqueBackground(null), false);
	assert.equal(isOpaqueBackground('rgba(0, 0, 0, 0)'), false);
	assert.equal(isOpaqueBackground('rgb(0 0 0 / 0%)'), false);
	assert.equal(isOpaqueBackground('#1e1e1e'), true);
	assert.equal(isOpaqueBackground('rgb(30, 30, 30)'), true);
	assert.equal(isOpaqueBackground('rgba(0, 0, 0, 0.5)'), true);
});

test('pickOpaqueBackground：跳过透明候选，取第一个不透明', () => {
	assert.equal(
		pickOpaqueBackground(['transparent', 'rgba(0, 0, 0, 0)', 'rgb(30, 30, 30)'], false),
		'rgb(30, 30, 30)',
	);
});

test('pickOpaqueBackground：全透明时按主题回落实底', () => {
	assert.equal(
		pickOpaqueBackground(['transparent', 'rgba(0, 0, 0, 0)'], true),
		'#1e1e1e',
	);
	assert.equal(
		pickOpaqueBackground(['transparent'], false),
		'#ffffff',
	);
});

/* ------------------------------------------------------------------ *
 * canvas 上限自动降倍率
 * ------------------------------------------------------------------ */

test('computeCanvasScaleLimit：小内容不降倍', () => {
	assert.equal(computeCanvasScaleLimit(1000, 2000, 2), 2);
});

test('computeCanvasScaleLimit：超高内容按单边上限下调', () => {
	// 1000 × 10000 @2× 会超单边 16384 → 上限 16384/10000 = 1.6384
	const limit = computeCanvasScaleLimit(1000, 10000, 2);
	assert.ok(Math.abs(limit - CANVAS_MAX_SIDE / 10000) < 1e-9);
	assert.ok(limit >= EXPORT_SCALE_MIN && limit < 2);
});

test('computeCanvasScaleLimit：下限恒为 1，绝不返回 <1 或非有限数', () => {
	const limit = computeCanvasScaleLimit(1000, 1_000_000, 2);
	assert.equal(limit, EXPORT_SCALE_MIN);
	assert.ok(Number.isFinite(computeCanvasScaleLimit(0, 0, 2)));
});

/* ------------------------------------------------------------------ *
 * 拍不到内容的判定
 * ------------------------------------------------------------------ */

test('hasUncapturableContent：命中 iframe / canvas-minimap 判 true', () => {
	const hit = { querySelector: () => ({}) };
	const miss = { querySelector: () => null };
	assert.equal(hasUncapturableContent(hit), true);
	assert.equal(hasUncapturableContent(miss), false);
});

/* ------------------------------------------------------------------ *
 * 可选页眉的辅助纯函数（Q3，默认关闭）
 * ------------------------------------------------------------------ */

test('parseCssColor：#rrggbb / #rgb / rgb() 都能解析，非法回 null', () => {
	assert.deepEqual(parseCssColor('#1e1e1e'), { r: 30, g: 30, b: 30 });
	assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseCssColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3 });
	assert.equal(parseCssColor('transparent'), null);
	assert.equal(parseCssColor(null), null);
});

test('readableTextColor：深底给浅字，浅底给深字', () => {
	assert.equal(readableTextColor('#1e1e1e'), '#f5f5f5');
	assert.equal(readableTextColor('#ffffff'), '#1f1f1f');
});

test('formatExportDate：YYYY-MM-DD HH:mm', () => {
	assert.equal(formatExportDate(new Date(2026, 9, 6, 9, 5)), '2026-10-06 09:05');
});

/* ------------------------------------------------------------------ *
 * 可选页尾（[[Discuss-20261008-091032]]，默认关闭）
 * ------------------------------------------------------------------ */

test('EXPORT_FOOTER_SLOGAN：逐字节固定，不被翻译 / 不被规范化', () => {
	assert.equal(
		EXPORT_FOOTER_SLOGAN,
		'IOTO - Your Super Utility Vehicle To Explore The Knowledge Land',
	);
});

// 线性度量（宽度 = 字符数 × 0.5 × 字号），便于构造确定的收敛用例。
const linearMeasure = (text, size) => text.length * size * 0.5;

test('fitFontSize：宽度够用时保持基准字号', () => {
	assert.equal(
		fitFontSize(EXPORT_FOOTER_SLOGAN, 600, 13, 9, linearMeasure),
		13,
	);
});

test('fitFontSize：宽度不够时按比例缩小并收敛（下限与基准之间）', () => {
	const maxWidth = 372;
	const size = fitFontSize(
		EXPORT_FOOTER_SLOGAN,
		maxWidth,
		13,
		9,
		linearMeasure,
	);
	assert.ok(size >= 9 && size < 13, `expected 9 <= ${size} < 13`);
	assert.ok(
		linearMeasure(EXPORT_FOOTER_SLOGAN, size) <= maxWidth + 1e-6,
		'the chosen size must fit within maxWidth',
	);
});

test('fitFontSize：极窄时缩到下限，绝不返回 < min 或非有限数', () => {
	assert.equal(fitFontSize(EXPORT_FOOTER_SLOGAN, 200, 13, 9, linearMeasure), 9);
	assert.equal(fitFontSize(EXPORT_FOOTER_SLOGAN, 1, 13, 9, linearMeasure), 9);
});

// 记录型 2D 上下文 + 假 canvas：验证 `composeExportFooter` 的真实几何与居中，
// 而不依赖浏览器 canvas（export.ts 里的 `createEl` 是 Obsidian 注入的全局）。
class RecordingCtx {
	constructor() {
		this.calls = { fillRect: [], drawImage: [], fillText: [] };
		this.font = '';
		this.globalAlpha = 1;
		this.textAlign = 'start';
		this.textBaseline = 'alphabetic';
		this.fillStyle = '#000';
	}
	fillRect(...args) {
		this.calls.fillRect.push(args);
	}
	drawImage(...args) {
		this.calls.drawImage.push(args);
	}
	fillText(text, x, y, maxWidth) {
		this.calls.fillText.push({
			text,
			x,
			y,
			maxWidth,
			font: this.font,
			alpha: this.globalAlpha,
			align: this.textAlign,
		});
	}
	measureText(text) {
		// 与 linearMeasure 同构：宽度 = 字符数 × 0.5 × 字号。
		return { width: text.length * 0.5 * Number.parseFloat(this.font) };
	}
}
class FakeCanvas {
	constructor() {
		this.width = 0;
		this.height = 0;
		this.ctx = new RecordingCtx();
	}
	getContext() {
		return this.ctx;
	}
}

test('composeExportFooter：底部追加一条带、居中绘制标语、source 原样贴上', () => {
	const prevCreateEl = globalThis.createEl;
	globalThis.createEl = () => new FakeCanvas();
	try {
		const source = new FakeCanvas();
		source.width = 800;
		source.height = 600;
		const out = composeExportFooter(source, {
			backgroundColor: '#1e1e1e',
			textColor: '#f5f5f5',
			scale: 2,
		});

		// 高度 = 内容高 + (topPad 14 + 基准字号 13 + bottomPad 14) × scale 2 = 600 + 82。
		assert.equal(out.width, 800);
		assert.equal(out.height, 682);
		// 整幅先用底色填满，再把内容图原样贴在左上角。
		assert.deepEqual(out.ctx.calls.fillRect[0], [0, 0, 800, 682]);
		assert.equal(out.ctx.calls.drawImage[0][0], source);
		assert.equal(out.ctx.calls.drawImage[0][1], 0);
		assert.equal(out.ctx.calls.drawImage[0][2], 0);

		const ft = out.ctx.calls.fillText[0];
		assert.ok(ft, 'should draw exactly one text line');
		assert.equal(ft.text, EXPORT_FOOTER_SLOGAN);
		assert.equal(ft.align, 'center');
		assert.equal(ft.alpha, 0.7);
		// 居中：x = canvas.width / 2；留白下限 maxWidth = width - 2×pad(=24×2)。
		assert.equal(ft.x, 400);
		assert.equal(ft.maxWidth, 704);
		// 自适应缩字号：介于 [9×2, 13×2] 之间；基线 y = source.height + topPad + 字号。
		const fontPx = Number.parseFloat(ft.font);
		assert.ok(fontPx >= 18 && fontPx <= 26, `font size ${fontPx} out of range`);
		assert.ok(Math.abs(ft.y - (600 + 28 + fontPx)) < 1e-6);
	} finally {
		globalThis.createEl = prevCreateEl;
	}
});

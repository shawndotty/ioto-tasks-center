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
	computeCanvasScaleLimit,
	formatExportDate,
	hasUncapturableContent,
	isOpaqueBackground,
	parseCssColor,
	pickOpaqueBackground,
	readableTextColor,
	CANVAS_MAX_SIDE,
	DEFAULT_EXPORT_SCALE,
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

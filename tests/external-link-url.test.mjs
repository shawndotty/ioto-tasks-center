import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// external-link-url.ts 零 obsidian 依赖（纯函数）→ 可直接 jiti 导入，无需先构建。
// 真实拦截效果（点击后主进程是否真的走 file: 分支、不弹确认框）属 DOM / 真机时序，
// 不进单测，需 Windows 真机 + macOS 回归验收（见 Plan-20261012-192019 §5.2）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { toExternalOpenUrl } = await jiti.import('../src/views/ioto-task/external-link-url.ts');

test('盘符路径：反斜杠 / 正斜杠 / 小写盘符 → file:///', () => {
	assert.equal(toExternalOpenUrl('C:\\Users\\a.pdf'), 'file:///C:/Users/a.pdf');
	assert.equal(toExternalOpenUrl('C:/Users/a.pdf'), 'file:///C:/Users/a.pdf');
	assert.equal(toExternalOpenUrl('d:/x/y.txt'), 'file:///d:/x/y.txt');
});

test('盘符路径：空格 / CJK 由 URL 自动 % 编码', () => {
	assert.equal(
		toExternalOpenUrl('C:\\My Docs\\学问.pdf'),
		'file:///C:/My%20Docs/%E5%AD%A6%E9%97%AE.pdf',
	);
});

test('已带 scheme → 原样透传（不回归）', () => {
	assert.equal(toExternalOpenUrl('file:///C:/Users/a.pdf'), 'file:///C:/Users/a.pdf');
	assert.equal(
		toExternalOpenUrl('file:///Users/johnny/Downloads/a.pdf'),
		'file:///Users/johnny/Downloads/a.pdf',
	);
	assert.equal(toExternalOpenUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
	assert.equal(toExternalOpenUrl('mailto:a@b.com'), 'mailto:a@b.com');
	assert.equal(toExternalOpenUrl('obsidian://open?vault=x'), 'obsidian://open?vault=x');
});

test('空值 / 纯空白 → 空串', () => {
	assert.equal(toExternalOpenUrl(''), '');
	assert.equal(toExternalOpenUrl('   '), '');
});

test('UNC → 四斜杠规范形（Phase 2 端到端可达，函数契约先稳定）', () => {
	assert.equal(
		toExternalOpenUrl('\\\\server\\share\\a.pdf'),
		'file:////server/share/a.pdf',
	);
	assert.equal(toExternalOpenUrl('//server/share/a.pdf'), 'file:////server/share/a.pdf');
});

test('POSIX 绝对路径 → file:///abs', () => {
	assert.equal(toExternalOpenUrl('/Users/johnny/a.pdf'), 'file:///Users/johnny/a.pdf');
});

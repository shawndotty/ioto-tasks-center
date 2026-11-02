/**
 * 外部链接解析与搜索（[[Plan-20261102-113642]] §4.10）。
 *
 * 判据全部来自计划 §3.2 在真实数据（13 条人工边界 + 库里 10 条真实外链）上
 * 跑通过的结论，不是纸上规则。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	parseExternalLinks,
	normalizeFileUrl,
	fileUrlToVaultPath,
	getExternalHost,
	getExternalFileName,
} = await jiti.import('../src/tasks-center/external-links.ts');
const { filterTaskLinks } = await jiti.import(
	'../src/tasks-center/task-links-index.ts',
);
const { isWebViewerOpenAllowed } = await jiti.import(
	'../src/views/tasks-center/open-external-url.ts',
);

const VAULT_BASE = '/Users/johnny/Documents/Sync/IOTO-Plugins';

/** 只取 URL 列表，断言顺序时读着更清楚。 */
function urls(raw) {
	return parseExternalLinks(raw).map((link) => link.url);
}

test('五种写法都能解析，且 label 取自各自的写法', () => {
	const markdown = parseExternalLinks(
		'[A 页](https://example.com/a "标题")',
	);
	assert.deepEqual(markdown, [
		{ url: 'https://example.com/a', label: 'A 页', scheme: 'https' },
	]);

	// 图片：alt 当文字（与核心 outlink popover 口径一致）。
	assert.deepEqual(parseExternalLinks('![img](https://example.com/a.png)'), [
		{ url: 'https://example.com/a.png', label: 'img', scheme: 'https' },
	]);

	// 自动链接：没有文字。
	assert.deepEqual(parseExternalLinks('<https://auto.example.com/x>'), [
		{ url: 'https://auto.example.com/x', label: '', scheme: 'https' },
	]);

	// 原始 HTML 锚点：label 取锚文字（内层标签被剥掉）。
	assert.deepEqual(
		parseExternalLinks('<a href="https://html.example.com/p">锚文字</a>'),
		[{ url: 'https://html.example.com/p', label: '锚文字', scheme: 'https' }],
	);

	// 行内代码：整段命令里只取第一个 URL（D2：行内代码里的 URL 要收）。
	assert.deepEqual(
		parseExternalLinks('`curl https://code.example.com/z`'),
		[{ url: 'https://code.example.com/z', label: '', scheme: 'https' }],
	);
	// 关闭该选项时行内代码不产出（选项留给「只看裸链」的调用方）。
	assert.deepEqual(
		parseExternalLinks('`curl https://code.example.com/z`', {
			includeInlineCode: false,
		}),
		[],
	);
});

test('裸链的六种边界：中文冒号 / 中文句号 / 全角括号 / 平衡括号 / 中文路径 / 加粗包裹', () => {
	assert.deepEqual(urls('链接：https://cn.example.com/路径'), [
		'https://cn.example.com/路径',
	]);
	assert.deepEqual(urls('结尾。https://tail.example.com/x。'), [
		'https://tail.example.com/x',
	]);
	assert.deepEqual(urls('（https://paren.example.com/x）'), [
		'https://paren.example.com/x',
	]);
	// 平衡括号不能被当作「尾随标点」削掉。
	assert.deepEqual(urls('https://wiki.example.com/Foo_(bar)'), [
		'https://wiki.example.com/Foo_(bar)',
	]);
	// 不配平的右括号要削掉。
	assert.deepEqual(urls('https://ex.example.com/x?y=1)'), [
		'https://ex.example.com/x?y=1',
	]);
	assert.deepEqual(urls('https://cn2.example.com/中文路径/片段'), [
		'https://cn2.example.com/中文路径/片段',
	]);
	// 加粗包裹：尾部 `**` 属于 Markdown，不是 URL 的一部分。
	assert.deepEqual(urls('**https://bold.example.com/x**'), [
		'https://bold.example.com/x',
	]);
});

test('围栏块 / frontmatter / 非 http(s)、file 的 scheme 都不收', () => {
	const raw = [
		'---',
		'source: https://fm.example.com',
		'---',
		'正文 https://body.example.com/x',
		'```',
		'https://code.example.com',
		'```',
		'~~~',
		'https://tilde.example.com',
		'~~~',
	].join('\n');
	assert.deepEqual(urls(raw), ['https://body.example.com/x']);

	// mailto: / obsidian:// 不在本 tab 的语义里（它们是「打开别的 App」，不是网页）。
	assert.deepEqual(urls('mailto:a@b.com obsidian://open?vault=x'), []);
});

test('去重：同 URL 只留第一条，label 取第一次出现的那处，顺序保持出现顺序', () => {
	const links = parseExternalLinks(
		'[第一次](https://dup.example.com/a)\nhttps://dup.example.com/a\n[第二次](https://dup.example.com/a)',
	);
	assert.equal(links.length, 1);
	assert.equal(links[0].label, '第一次');

	assert.deepEqual(
		urls('https://b.example.com https://a.example.com'),
		// 不排序：笔记里的先后有叙事价值。
		['https://b.example.com', 'https://a.example.com'],
	);
});

test('normalizeFileUrl：只把 file: 的反斜杠改成正斜杠', () => {
	assert.equal(
		normalizeFileUrl('file:///D:\\Downloads\\a.pdf'),
		'file:///D:/Downloads/a.pdf',
	);
	assert.equal(normalizeFileUrl('https://x/y\\z'), 'https://x/y\\z');
	// 解析阶段就已经归一化：去重键与「交给 Web viewer 的 URL」同形。
	assert.deepEqual(urls('file:///D:\\Downloads\\a.pdf'), [
		'file:///D:/Downloads/a.pdf',
	]);
});

test('fileUrlToVaultPath：命中 / 前缀边界 / 大小写 / 百分号编码 / 相对形 / 库根 / 畸形编码', () => {
	assert.equal(
		fileUrlToVaultPath(
			'file:///Users/johnny/Documents/Sync/IOTO-Plugins/3-%E4%BB%BB%E5%8A%A1/a.md',
			VAULT_BASE,
		),
		'3-任务/a.md',
	);
	// `/Vault2` 不算 `/Vault`：必须吃到路径分隔符。
	assert.equal(
		fileUrlToVaultPath(
			'file:///Users/johnny/Documents/Sync/IOTO-Plugins2/a.md',
			VAULT_BASE,
		),
		null,
	);
	// 大小写不敏感（macOS / Windows），但返回值保留原始大小写。
	assert.equal(
		fileUrlToVaultPath(
			'file:///users/JOHNNY/Documents/Sync/IOTO-Plugins/x/y.md',
			VAULT_BASE,
		),
		'x/y.md',
	);
	// 相对形态语义上不合法 → 丢弃。
	assert.equal(fileUrlToVaultPath('file://../a.md', VAULT_BASE), null);
	// 库根自身不是「库里的文件」。
	assert.equal(
		fileUrlToVaultPath(
			'file:///Users/johnny/Documents/Sync/IOTO-Plugins',
			VAULT_BASE,
		),
		null,
	);
	// 畸形 `%` 序列 → 当库外，不抛错。
	assert.equal(
		fileUrlToVaultPath(
			'file:///Users/johnny/Documents/Sync/IOTO-Plugins/%E0%A4%A.md',
			VAULT_BASE,
		),
		null,
	);
	// Windows 盘符形：`file:///C:/…` → `C:/…` 后与库根比。
	assert.equal(
		fileUrlToVaultPath('file:///D:/Vault/My%20Note.md', 'D:/Vault'),
		'My Note.md',
	);
});

test('getExternalHost / getExternalFileName：端口、query、CJK 解码', () => {
	assert.equal(
		getExternalHost('https://a.example.com:8443/x?q=1'),
		'a.example.com:8443',
	);
	assert.equal(getExternalHost('file:///a/b.pdf'), '');
	assert.equal(
		getExternalFileName('file:///D:/Downloads/%E5%AD%A6%E9%97%AE.pdf'),
		'学问.pdf',
	);
	assert.equal(getExternalFileName('https://a/b.pdf?x=1'), 'b.pdf');
	assert.equal(getExternalFileName('https://a/'), '');
});

test('isWebViewerOpenAllowed：显式 false 才关门，缺失/undefined/true 都视为开启（[[Plan-20261102-192630]] §3.1）', () => {
	// 核心默认 true（F4），且 onEnable 保证 options 存在 → true 允许。
	assert.equal(isWebViewerOpenAllowed({ options: { openExternalURLs: true } }), true);
	// 本需求的正例：设置关闭 → 不允许（落系统浏览器兜底）。
	assert.equal(isWebViewerOpenAllowed({ options: { openExternalURLs: false } }), false);
	// 字段缺失 / options 缺失 / viewer 为 null：异常环境按开启处理（最保守方向）。
	assert.equal(isWebViewerOpenAllowed({}), true);
	assert.equal(isWebViewerOpenAllowed({ options: {} }), true);
	assert.equal(isWebViewerOpenAllowed(null), false, 'viewer 为 null 是原有「拿不到实例」判据，防回归');
});

/** 「可见即可搜」的一条外部条目：title 是链接文字，subtitle 是域名。 */
function createExternalEntry(options = {}) {
	return {
		path: options.path ?? 'https://github.com/shawndotty/text-popup',
		title: options.title ?? 'A 页',
		subPath: options.path ?? 'https://github.com/shawndotty/text-popup',
		kind: 'external',
		subtitle: options.subtitle ?? 'github.com',
	};
}

function createSnapshot(...external) {
	return {
		sections: {
			subtask: [],
			input: [],
			output: [],
			outcome: [],
			other: [],
			external,
		},
	};
}

test('外部条目的搜索：链接文字 / 域名 / 完整 URL 都可命中，仅正文范围时 0 条', () => {
	const snapshot = createSnapshot(createExternalEntry());
	const bodies = new Map();

	assert.equal(
		filterTaskLinks(snapshot, 'A 页', bodies).counts.external,
		1,
		'链接文字应可搜',
	);
	assert.equal(
		filterTaskLinks(snapshot, 'github.com', bodies).counts.external,
		1,
		'域名在 subtitle 上，也必须可搜（D6）',
	);
	assert.equal(
		filterTaskLinks(snapshot, 'shawndotty/text-popup', bodies).counts.external,
		1,
		'完整 URL 在 tooltip 里看得见，粘一段来搜是自然动作',
	);
	// 外链没有正文：仅正文范围时恒 0（空态归因会把「范围」列为可放宽项）。
	assert.equal(
		filterTaskLinks(snapshot, 'A 页', bodies, { scope: 'body' }).counts
			.external,
		0,
	);
	assert.equal(
		filterTaskLinks(snapshot, '不存在的词', bodies).counts.external,
		0,
	);
});

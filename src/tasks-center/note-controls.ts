/**
 * 任务笔记的控制项（执行元数据）扫描器。
 *
 * 纯字符串 → `ControlToken`，零 DOM / 零 obsidian 运行时依赖。`splitDisplayText`
 * 同时被 `note-checklist` 与 `note-task-line` 两个子域调用，因此集中在此处导出。
 * 由 `tests/task-controls.test.mjs` 经 barrel 间接锁定。
 */

/** 条目控制项类别（v1 锁定集合，见 [[Plan-20261003-162429]] §二）。 */
export type ControlKind =
	| 'depends' // #ioto/depends/N 或 depends：[[…]]
	| 'agent' // #ioto/agent/<id>
	| 'model' // #ioto/model/<id> 或 [model:: <id>]
	| 'fanout' // #ioto/fanout 或 #ioto/fanout/N
	| 'turns'; // #ioto/turns/<N>

/** 一条控制项：`raw` 逐字节保留用于无损写回，`value` 供渲染层展示。 */
export interface ControlToken {
	kind: ControlKind;
	/** 原文片段，逐字节保留（含 `depends：` / `#ioto/…` / `[model:: …]` 全串） */
	raw: string;
	/** 解析出的值：depends=string[]、fanout=true|number、turns=number、agent/model=string */
	value: string | number | true | string[];
}

interface ControlScanner {
	kind: ControlKind;
	/** 必须带 `g` 标志，供逐条 exec 收集全部命中 */
	pattern: RegExp;
	build: (match: RegExpExecArray) => ControlToken['value'];
}

const CONTROL_SCANNERS: ControlScanner[] = [
	{
		kind: 'depends',
		pattern:
			/depends\s*[：:]\s*(\[\[[^\]]+\]\](?:\s*[、,]\s*\[\[[^\]]+\]\])*)/g,
		build: (match) =>
			Array.from(match[1]?.matchAll(/\[\[([^\]]+)\]\]/g) ?? [], (link) =>
				link[1] ?? '',
			),
	},
	{
		kind: 'depends',
		pattern: /#ioto\/depends\/(\d+)/g,
		build: (match) => Number(match[1]),
	},
	{
		kind: 'agent',
		pattern: /#ioto\/agent\/([^\s#]+)/g,
		build: (match) => match[1] ?? '',
	},
	{
		kind: 'model',
		pattern: /\[model\s*::\s*([^\]]+)\]/g,
		build: (match) => (match[1] ?? '').trim(),
	},
	{
		kind: 'model',
		pattern: /#ioto\/model\/([^\s#]+)/g,
		build: (match) => match[1] ?? '',
	},
	{
		kind: 'fanout',
		pattern: /#ioto\/fanout(?:\/(\d+))?/g,
		build: (match) => (match[1] === undefined ? true : Number(match[1])),
	},
	{
		kind: 'turns',
		pattern: /#ioto\/turns\/(\d+)/g,
		build: (match) => Number(match[1]),
	},
];

interface ScannedControl {
	token: ControlToken;
	start: number;
	end: number;
}

/**
 * 扫描 `core`，按出现顺序收集控制项；重叠区间只保留「更早出现」者。
 * 所有匹配区间都不跨行（正则本身不含换行）。
 */
function scanControls(core: string): ScannedControl[] {
	const hits: ScannedControl[] = [];

	for (const scanner of CONTROL_SCANNERS) {
		scanner.pattern.lastIndex = 0;
		let match = scanner.pattern.exec(core);
		while (match) {
			hits.push({
				token: {
					kind: scanner.kind,
					raw: match[0],
					value: scanner.build(match),
				},
				start: match.index,
				end: match.index + match[0].length,
			});
			if (match[0].length === 0) {
				scanner.pattern.lastIndex += 1;
			}
			match = scanner.pattern.exec(core);
		}
	}

	hits.sort((a, b) => a.start - b.start || b.end - a.end);

	const accepted: ScannedControl[] = [];
	let lastEnd = -1;
	for (const hit of hits) {
		if (hit.start < lastEnd) {
			continue;
		}
		accepted.push(hit);
		lastEnd = hit.end;
	}

	return accepted;
}

/**
 * 把一条任务正文拆成「展示正文 + 控制项集合」。
 *
 * 用哨兵标记被剥离的控制项区间，再把「哨兵两侧的空白」收敛成单个空格，
 * 这样只会吃掉接缝处的空白，正文内部的多空格保持不变。
 * 哨兵选私有使用区字符（非控制字符，且正文里不会出现）。
 */
export function splitDisplayText(rawTaskContent: string): {
	text: string;
	controls: ControlToken[];
} {
	const core = rawTaskContent.trim();
	const scanned = scanControls(core);
	if (scanned.length === 0) {
		return { text: core, controls: [] };
	}

	const SENTINEL = '\uE000';
	let marked = '';
	let cursor = 0;
	for (const hit of scanned) {
		marked += core.slice(cursor, hit.start) + SENTINEL;
		cursor = hit.end;
	}
	marked += core.slice(cursor);

	const text = marked
		.replace(/\s*\uE000(?:\s*\uE000)*\s*/g, ' ')
		.replace(/\uE000/g, '')
		.trim();
	return { text, controls: scanned.map((hit) => hit.token) };
}

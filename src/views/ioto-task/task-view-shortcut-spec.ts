/**
 * IOTOTask 视图内置键位的**唯一书面清单**（帮助面板数据源，[[Plan-20261028-110920]]）。
 *
 * 🔴 新增 / 删除 / 改键：必须同步本文件 + `tests/task-view-shortcuts.test.mjs`。
 *    视图内键位没有运行时注册表可反查（`View.scope` 不可枚举、卡片/编辑器键位是闭包
 *    里的 switch），本文件是人工维护的「文档」，不是自动真源。
 * 🔴 只有 `Mod+F` / `Mod+Enter` 是结构性共享：它们直接引用 scope 模块的常量。
 * 本模块**不 import obsidian**（只 `import type` 取 TranslationKey），可 jiti 单测。
 */

import type { TranslationKey } from '../../lang/helpter';
import { SEARCH_HOTKEY_KEY, SEARCH_HOTKEY_MODIFIERS } from './search-scope';
import {
	SELECT_MODE_HOTKEY_KEY,
	SELECT_MODE_HOTKEY_MODIFIERS,
} from './select-mode-scope';

/** 逻辑键位 token。新增字母键位（如 'G'）时在此补一项并在两张 label 表里登记。 */
export type KeyToken =
	| 'Mod'
	| 'Shift'
	| 'Alt'
	| 'Enter'
	| 'Esc'
	| 'Tab'
	| 'Delete'
	| 'Backspace'
	| 'ArrowUp'
	| 'ArrowDown'
	| 'F';

export interface ShortcutEntry {
	/** 一个内层数组 = 一次按键组合；多个内层数组 = 同一动作的多种按法（Delete / Backspace）。 */
	chords: KeyToken[][];
	/** 无法用键帽表达的行（如「任意其它键」）——有值时忽略 `chords`，渲染为普通文本。 */
	keyTextKey?: TranslationKey;
	labelKey: TranslationKey;
	/** 同一行可以挂多条补充说明（如 Mod+Enter 的两条限制）。 */
	noteKeys?: TranslationKey[];
	/**
	 * 同组内确实存在同键不同语义的行（如「节与拖拽」组里正文 Enter 与标题 Enter），
	 * 置 true 让单测的「同组无重复 chord」检查放行——只在语义真的不同时使用。
	 */
	allowDuplicateChord?: boolean;
}

export interface ShortcutGroup {
	/** 'view' | 'select' | …（测试与将来「高亮当前组」共用）。 */
	id: string;
	titleKey: TranslationKey;
	whenKey: TranslationKey;
	entries: ShortcutEntry[];
}

const MAC_LABELS: Record<KeyToken, string> = {
	Mod: '⌘',
	Shift: '⇧',
	Alt: '⌥',
	Enter: '↵',
	Esc: 'esc',
	Tab: '⇥',
	Delete: '⌦',
	Backspace: '⌫',
	ArrowUp: '↑',
	ArrowDown: '↓',
	F: 'F',
};

const DEFAULT_LABELS: Record<KeyToken, string> = {
	Mod: 'Ctrl',
	Shift: 'Shift',
	Alt: 'Alt',
	Enter: 'Enter',
	Esc: 'Esc',
	Tab: 'Tab',
	Delete: 'Delete',
	Backspace: 'Backspace',
	ArrowUp: '↑',
	ArrowDown: '↓',
	F: 'F',
};

/** 逻辑 token → 平台化标签（逐 token 返回，便于一个键一个 `<kbd>`）。 */
export function formatShortcut(
	chord: KeyToken[],
	opts: { isMac: boolean },
): string[] {
	const table = opts.isMac ? MAC_LABELS : DEFAULT_LABELS;
	return chord.map((token) => table[token]);
}

/** 大小写不敏感的 token 归一表：`'f'` / `'Enter'` / `'ARROWUP'` 都能落到同一 token。 */
const TOKEN_CANONICAL: Readonly<Record<string, KeyToken>> = {
	MOD: 'Mod',
	SHIFT: 'Shift',
	ALT: 'Alt',
	ENTER: 'Enter',
	ESC: 'Esc',
	TAB: 'Tab',
	DELETE: 'Delete',
	BACKSPACE: 'Backspace',
	ARROWUP: 'ArrowUp',
	ARROWDOWN: 'ArrowDown',
	F: 'F',
};

/** 未登记的 token 直接抛错（改键位忘了改本文件时立刻炸）。 */
function asKeyToken(raw: string): KeyToken {
	const token = TOKEN_CANONICAL[raw.toUpperCase()];
	if (!token) {
		throw new Error(`task-view-shortcut-spec: 未登记的键位 token「${raw}」`);
	}
	return token;
}

/** scope 常量（`['Mod']` + `'f'`）→ 本模块的 token 序列。 */
export function buildScopeChord(
	modifiers: readonly string[],
	key: string,
): KeyToken[] {
	return [...modifiers.map(asKeyToken), asKeyToken(key)];
}

/** 与 `search-scope.ts` 结构性共享：改那边的键位，面板这一行跟着变。 */
export const SEARCH_CHORD = buildScopeChord(
	SEARCH_HOTKEY_MODIFIERS,
	SEARCH_HOTKEY_KEY,
);
/** 与 `select-mode-scope.ts` 结构性共享。 */
export const TOGGLE_DONE_CHORD = buildScopeChord(
	SELECT_MODE_HOTKEY_MODIFIERS,
	SELECT_MODE_HOTKEY_KEY,
);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		id: 'view',
		titleKey: 'shortcutHelp.group.view',
		whenKey: 'shortcutHelp.when.view',
		entries: [
			{
				chords: [SEARCH_CHORD],
				labelKey: 'shortcutHelp.action.view.search',
				noteKeys: ['shortcutHelp.note.view.searchEditing'],
			},
		],
	},
	{
		id: 'select',
		titleKey: 'shortcutHelp.group.select',
		whenKey: 'shortcutHelp.when.select',
		entries: [
			{
				chords: [['Enter']],
				labelKey: 'shortcutHelp.action.select.enter',
				noteKeys: ['shortcutHelp.note.select.zoom'],
			},
			{
				chords: [['Shift', 'Enter']],
				labelKey: 'shortcutHelp.action.select.shiftEnter',
			},
			{
				chords: [['ArrowUp'], ['ArrowDown']],
				labelKey: 'shortcutHelp.action.select.arrows',
			},
			{
				chords: [
					['Mod', 'ArrowUp'],
					['Mod', 'ArrowDown'],
				],
				labelKey: 'shortcutHelp.action.select.jumpEdges',
			},
			{
				chords: [
					['Tab'],
					['Shift', 'Tab'],
				],
				labelKey: 'shortcutHelp.action.select.indent',
			},
			{
				chords: [TOGGLE_DONE_CHORD],
				labelKey: 'shortcutHelp.action.select.toggleDone',
				noteKeys: [
					'shortcutHelp.note.select.toggleDone',
					'shortcutHelp.note.select.toggleDonePending',
				],
			},
			{
				chords: [['Delete'], ['Backspace']],
				labelKey: 'shortcutHelp.action.select.requestDelete',
				noteKeys: ['shortcutHelp.note.select.requestDelete'],
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.select.exitSectionZoom',
				noteKeys: ['shortcutHelp.note.select.escZoomOnly'],
			},
		],
	},
	{
		id: 'deleteConfirm',
		titleKey: 'shortcutHelp.group.deleteConfirm',
		whenKey: 'shortcutHelp.when.deleteConfirm',
		entries: [
			{
				chords: [['Enter']],
				labelKey: 'shortcutHelp.action.delete.confirm',
			},
			{
				chords: [['Delete'], ['Backspace']],
				labelKey: 'shortcutHelp.action.delete.confirmAgain',
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.delete.cancel',
			},
			{
				chords: [],
				keyTextKey: 'shortcutHelp.key.anyOther',
				labelKey: 'shortcutHelp.action.delete.fallthrough',
			},
		],
	},
	{
		id: 'editTitle',
		titleKey: 'shortcutHelp.group.editTitle',
		whenKey: 'shortcutHelp.when.editTitle',
		entries: [
			{
				chords: [['Enter']],
				labelKey: 'shortcutHelp.action.editTitle.enter',
				noteKeys: ['shortcutHelp.note.editTitle.suggestion'],
			},
			{
				chords: [['Shift', 'Enter']],
				labelKey: 'shortcutHelp.action.editTitle.shiftEnter',
			},
			{
				chords: [['Mod', 'Enter']],
				labelKey: 'shortcutHelp.action.editTitle.modEnter',
			},
			{
				chords: [
					['Tab'],
					['Shift', 'Tab'],
				],
				labelKey: 'shortcutHelp.action.editTitle.indent',
			},
			{
				chords: [['Backspace']],
				labelKey: 'shortcutHelp.action.editTitle.backspaceEmpty',
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.editTitle.esc',
				noteKeys: ['shortcutHelp.note.editTitle.zoom'],
			},
		],
	},
	{
		id: 'continuation',
		titleKey: 'shortcutHelp.group.continuation',
		whenKey: 'shortcutHelp.when.continuation',
		entries: [
			{
				chords: [['Enter']],
				labelKey: 'shortcutHelp.action.continuation.enter',
			},
			{
				chords: [['Tab']],
				labelKey: 'shortcutHelp.action.continuation.tab',
			},
			{
				chords: [['Backspace']],
				labelKey: 'shortcutHelp.action.continuation.backspaceEmpty',
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.continuation.esc',
			},
		],
	},
	{
		id: 'search',
		titleKey: 'shortcutHelp.group.search',
		whenKey: 'shortcutHelp.when.search',
		entries: [
			{
				chords: [
					['Enter'],
					['Shift', 'Enter'],
				],
				labelKey: 'shortcutHelp.action.search.enter',
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.search.esc',
			},
		],
	},
	{
		id: 'section',
		titleKey: 'shortcutHelp.group.section',
		whenKey: 'shortcutHelp.when.section',
		entries: [
			{
				chords: [['Enter']],
				labelKey: 'shortcutHelp.action.section.enter',
			},
			{
				chords: [['Tab']],
				labelKey: 'shortcutHelp.action.section.tab',
				noteKeys: ['shortcutHelp.note.section.tabBodyOnly'],
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.section.esc',
				// 与末行「拖拽中 Esc」同键不同语义，故放行单测的去重检查
				allowDuplicateChord: true,
			},
			{
				chords: [
					['Enter'],
					['Esc'],
				],
				labelKey: 'shortcutHelp.action.section.titleEnter',
				noteKeys: ['shortcutHelp.note.section.titleVsBody'],
			},
			{
				chords: [['Esc']],
				labelKey: 'shortcutHelp.action.section.dragEsc',
				// 同上：拖拽 Esc 与节正文 Esc 是两条不同的键位
				allowDuplicateChord: true,
			},
		],
	},
];

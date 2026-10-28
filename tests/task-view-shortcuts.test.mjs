import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });

const spec = await jiti.import(
	'../src/views/ioto-task/task-view-shortcut-spec.ts',
);
const scope = await jiti.import('../src/views/ioto-task/search-scope.ts');
const selectScope = await jiti.import(
	'../src/views/ioto-task/select-mode-scope.ts',
);
const en = (await jiti.import('../src/lang/locale/en.ts')).default;

const {
	SHORTCUT_GROUPS,
	buildScopeChord,
	formatShortcut,
} = spec;

const allEntries = SHORTCUT_GROUPS.flatMap((group) =>
	group.entries.map((entry) => ({ group, entry })),
);

test('formatShortcut：macOS 用符号，其它平台用英文键名', () => {
	assert.deepEqual(formatShortcut(['Mod', 'Enter'], { isMac: true }), [
		'⌘',
		'↵',
	]);
	assert.deepEqual(formatShortcut(['Mod', 'Enter'], { isMac: false }), [
		'Ctrl',
		'Enter',
	]);
});

test('formatShortcut：逐 token 一一对应，不产生 undefined', () => {
	for (const entry of allEntries.map((row) => row.entry)) {
		for (const chord of entry.chords) {
			for (const isMac of [true, false]) {
				const labels = formatShortcut(chord, { isMac });
				assert.equal(labels.length, chord.length);
				for (const label of labels) {
					assert.equal(typeof label, 'string');
					assert.ok(label.length > 0);
				}
			}
		}
	}
});

test('结构：7 组 / 30 行 / 组内非空 / id 唯一', () => {
	assert.equal(SHORTCUT_GROUPS.length, 7);
	assert.equal(allEntries.length, 30);
	const ids = SHORTCUT_GROUPS.map((group) => group.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const group of SHORTCUT_GROUPS) {
		assert.ok(
			group.entries.length > 0,
			`group "${group.id}" should not be empty`,
		);
	}
});

test('与 scope 常量结构性对齐：Mod+F / Mod+Enter 直接来自常量', () => {
	const searchChord = buildScopeChord(
		scope.SEARCH_HOTKEY_MODIFIERS,
		scope.SEARCH_HOTKEY_KEY,
	);
	const searchRow = allEntries.find(
		(row) =>
			row.entry.chords.length === 1 &&
			row.entry.chords[0].join('+') === searchChord.join('+'),
	);
	assert.ok(searchRow, 'Mod+F 行缺失');
	assert.equal(searchRow.group.id, 'view');

	const toggleChord = buildScopeChord(
		selectScope.SELECT_MODE_HOTKEY_MODIFIERS,
		selectScope.SELECT_MODE_HOTKEY_KEY,
	);
	const toggleRow = allEntries.find(
		(row) =>
			row.entry.chords.length === 1 &&
			row.entry.chords[0].join('+') === toggleChord.join('+'),
	);
	assert.ok(toggleRow, 'Mod+Enter 行缺失');
	assert.equal(toggleRow.group.id, 'select');
});

test('i18n：spec 里出现的每个 key 在 en 字典里都存在且非空', () => {
	const keys = new Set();
	for (const group of SHORTCUT_GROUPS) {
		keys.add(group.titleKey);
		keys.add(group.whenKey);
		for (const entry of group.entries) {
			keys.add(entry.labelKey);
			if (entry.keyTextKey) {
				keys.add(entry.keyTextKey);
			}
			for (const noteKey of entry.noteKeys ?? []) {
				keys.add(noteKey);
			}
		}
	}

	for (const key of keys) {
		assert.ok(key in en, `en 缺少 key：${key}`);
		assert.ok(
			typeof en[key] === 'string' && en[key].trim().length > 0,
			`en.${key} 不应为空`,
		);
	}
});

test('同组内无重复 chord（抓「复制粘贴改描述忘改键」）', () => {
	for (const group of SHORTCUT_GROUPS) {
		const byChord = new Map();
		for (const entry of group.entries) {
			if (entry.keyTextKey) continue;
			const serialized = entry.chords
				.map((chord) => chord.join('+'))
				.join('|');
			const rows = byChord.get(serialized) ?? [];
			rows.push(entry);
			byChord.set(serialized, rows);
		}
		for (const [serialized, rows] of byChord) {
			if (rows.length < 2) continue;
			// 显式声明「同键不同语义」的行（如节正文 Esc / 拖拽中 Esc）放行
			assert.ok(
				rows.every((entry) => entry.allowDuplicateChord === true),
				`group "${group.id}" 内 chord「${serialized}」重复且未声明 allowDuplicateChord`,
			);
		}
	}
});

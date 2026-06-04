import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	getCurrentLang,
	resolveLocaleKey,
	translate,
} = await jiti.import('../src/lang/helpter.ts');

test('unknown locale falls back to en', () => {
	assert.equal(resolveLocaleKey('fr-FR'), 'en');
});

test('zh locale resolves to zh-cn', () => {
	assert.equal(resolveLocaleKey('zh'), 'zh-cn');
	assert.equal(resolveLocaleKey('zh-CN'), 'zh-cn');
});

test('traditional Chinese locales resolve to zh-tw', () => {
	assert.equal(resolveLocaleKey('zh-TW'), 'zh-tw');
	assert.equal(resolveLocaleKey('zh-HK'), 'zh-tw');
});

test('translate returns English strings by default locale key', () => {
	assert.equal(translate('en', 'view.title'), 'Tasks center');
	assert.equal(translate('en-US', 'task.status.todo'), 'To do');
});

test('translate returns localized strings for zh-cn and zh-tw', () => {
	assert.equal(translate('zh-cn', 'view.title'), '任务中心');
	assert.equal(translate('zh-tw', 'view.title'), '任務中心');
});

test('translate supports placeholder interpolation', () => {
	assert.equal(
		translate('en', 'view.projectSwitcher.current', ['Project A']),
		'Current project: Project A',
	);
});

test('getCurrentLang prefers the language configured by Obsidian', () => {
	const originalWindow = globalThis.window;
	const originalDocument = globalThis.document;

	globalThis.window = {
		localStorage: {
			getItem: (key) => (key === 'language' ? 'zh' : null),
		},
	};
	globalThis.document = {
		documentElement: {
			lang: 'en',
		},
	};

	try {
		assert.equal(getCurrentLang(), 'zh-cn');
	} finally {
		globalThis.window = originalWindow;
		globalThis.document = originalDocument;
	}
});

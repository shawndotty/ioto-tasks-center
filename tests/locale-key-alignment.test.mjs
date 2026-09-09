import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });

const localeDir = fileURLToPath(new URL('../src/lang/locale/', import.meta.url));

// Discover locale files automatically so newly added languages are checked
// without editing this test. `en` acts as the canonical reference for keys.
const localeFiles = readdirSync(localeDir).filter(
	(file) => file.endsWith('.ts') && !file.startsWith('index'),
);

const REFERENCE = 'en';

const locales = {};
for (const file of localeFiles) {
	const name = file.replace(/\.ts$/, '');
	locales[name] = (
		await jiti.import(`../src/lang/locale/${file}`)
	).default;
}

const referenceKeys = Object.keys(locales[REFERENCE]).sort();

test('locale directory is discovered with the reference language', () => {
	assert.ok(
		localeFiles.length >= 2,
		`expected at least 2 locale files, found ${localeFiles.length}`,
	);
	assert.ok(
		REFERENCE in locales,
		`"${REFERENCE}" locale must exist and act as the key reference`,
	);
});

// Core invariant: every locale file must declare exactly the same set of keys
// as the reference ("en"). Missing or extra keys break runtime fallbacks and
// cause untranslated / duplicated strings.
for (const name of Object.keys(locales)) {
	if (name === REFERENCE) continue;

	test(`locale "${name}" has exactly the same keys as "${REFERENCE}"`, () => {
		const keys = Object.keys(locales[name]).sort();
		const missing = referenceKeys.filter((key) => !keys.includes(key));
		const extra = keys.filter((key) => !referenceKeys.includes(key));

		assert.deepEqual(
			keys,
			referenceKeys,
			[
				`Key mismatch between "${name}" and "${REFERENCE}".`,
				missing.length ? `Missing in "${name}": ${missing.join(', ')}` : null,
				extra.length ? `Extra in "${name}": ${extra.join(', ')}` : null,
			]
				.filter(Boolean)
				.join('\n'),
		);
	});
}

// Value sanity: every translation value should be a non-empty string so that
// the UI never renders an empty or non-string label.
test('every translation value is a non-empty string', () => {
	for (const [name, dict] of Object.entries(locales)) {
		for (const [key, value] of Object.entries(dict)) {
			assert.equal(
				typeof value,
				'string',
				`${name}.${key} should be a string, got ${typeof value}`,
			);
			assert.ok(
				value.trim().length > 0,
				`${name}.${key} should not be empty`,
			);
		}
	}
});

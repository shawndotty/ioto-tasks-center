import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isEmbeddedEditorSupported } = await jiti.import(
	'../src/views/ioto-task/embedded-editor.ts',
);

test('isEmbeddedEditorSupported：有 embedByExtension.md 才算支持', () => {
	assert.equal(
		isEmbeddedEditorSupported({ embedByExtension: { md: () => {} } }),
		true,
	);
	assert.equal(isEmbeddedEditorSupported({ embedByExtension: {} }), false);
	assert.equal(isEmbeddedEditorSupported({}), false);
	assert.equal(isEmbeddedEditorSupported(null), false);
	assert.equal(isEmbeddedEditorSupported(undefined), false);
});

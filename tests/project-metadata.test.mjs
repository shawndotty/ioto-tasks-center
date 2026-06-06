import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	readProjectMetadataFromContent,
	upsertProjectMetadataInContent,
} = await jiti.import('../src/tasks-center/project-metadata.ts');

test('写入 category 会创建 IOTOProject frontmatter', () => {
	const next = upsertProjectMetadataInContent('', { category: '研发' });
	assert.equal(
		next,
		`---\nIOTOProject:\n  category: "研发"\n---\n`,
	);
	assert.deepEqual(readProjectMetadataFromContent(next), {
		category: '研发',
	});
});

test('写入 startDate 与 dueDate 会追加到 IOTOProject 中', () => {
	const base = `---\nIOTOProject:\n  category: "研发"\n---\n# 标题\n`;
	const next = upsertProjectMetadataInContent(base, {
		startDate: '2026-06-06',
		dueDate: '2026-06-30',
	});
	assert.equal(
		next,
		`---\nIOTOProject:\n  category: "研发"\n  startDate: "2026-06-06"\n  dueDate: "2026-06-30"\n---\n# 标题\n`,
	);
	assert.deepEqual(readProjectMetadataFromContent(next), {
		category: '研发',
		startDate: '2026-06-06',
		dueDate: '2026-06-30',
	});
});

test('传入 null 会删除对应字段，并在空对象时移除 IOTOProject', () => {
	const base = `---\nIOTOProject:\n  category: "研发"\n---\n`;
	const next = upsertProjectMetadataInContent(base, { category: null });
	assert.equal(next, '');
	assert.deepEqual(readProjectMetadataFromContent(next), {});
});


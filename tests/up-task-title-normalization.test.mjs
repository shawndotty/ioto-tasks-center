import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 别名把 `obsidian` 指向最小实现：`data.ts` 在运行期会用到 TFile / TFolder。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { getUpTaskTitlesFromContent } = await jiti.import(
	'../src/tasks-center/data.ts',
);

function contentWithUpTask(value) {
	return `---\nUpTask: "${value}"\nProject:\n  - "项目A"\n---\n\n正文`;
}

const cases = [
	['[[A]]', 'A'],
	['[[A|别名]]', 'A'],
	['[[A#某标题]]', 'A'],
	['[[A#H|别名]]', 'A'],
];

for (const [raw, expected] of cases) {
	test(`UpTask ${raw} 归一化为 ${expected}`, () => {
		assert.deepEqual(getUpTaskTitlesFromContent(contentWithUpTask(raw)), [
			expected,
		]);
	});
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// preview-theme-vars.ts 零 obsidian 依赖（取值纯函数）→ jiti 直接导入，无需先构建。
// 真实拦截效果（预览体计算色是否等于主题侧 `--hN-color`）属 DOM / 主题运行时，
// 不进单测，走真机验收（见 Plan-20261103-150245 §六）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { HEADING_COLOR_VARS, readHeadingColorVars } = await jiti.import(
	'../src/tasks-center/preview-theme-vars.ts',
);

// 只实现 `getPropertyValue`：函数签名收窄成 `Pick<CSSStyleDeclaration,'getPropertyValue'>`，
// 假对象两行即可，不必造整个 CSSStyleDeclaration。
const fakeScope = (map) => ({ getPropertyValue: (name) => map[name] ?? '' });

test('六项都有值：键的顺序与内容都等于 HEADING_COLOR_VARS', () => {
	const result = readHeadingColorVars(
		fakeScope({
			'--h1-color': 'rgb(243, 139, 168)',
			'--h2-color': 'rgb(250, 179, 135)',
			'--h3-color': 'rgb(249, 226, 175)',
			'--h4-color': 'rgb(166, 227, 161)',
			'--h5-color': 'rgb(137, 180, 250)',
			'--h6-color': 'rgb(203, 166, 247)',
		}),
	);
	assert.deepEqual(Object.keys(result), [...HEADING_COLOR_VARS]);
	assert.equal(result['--h1-color'], 'rgb(243, 139, 168)');
	assert.equal(result['--h6-color'], 'rgb(203, 166, 247)');
});

test('值前后带空格（getComputedStyle 自定义变量的真实形态）→ trim', () => {
	const result = readHeadingColorVars(
		fakeScope({ '--h1-color': ' rgb(243, 139, 168) ' }),
	);
	assert.equal(result['--h1-color'], 'rgb(243, 139, 168)');
});

test('六项全空（默认主题 / 弹窗侧）→ 六项都是空串，不是 undefined', () => {
	const result = readHeadingColorVars(fakeScope({}));
	for (const name of HEADING_COLOR_VARS) {
		assert.equal(result[name], '');
	}
});

test('只有 --h2-color 有值 → h2 透传，其余五项仍空串', () => {
	const result = readHeadingColorVars(
		fakeScope({ '--h2-color': 'rgb(250, 179, 135)' }),
	);
	assert.equal(result['--h2-color'], 'rgb(250, 179, 135)');
	for (const name of HEADING_COLOR_VARS.filter((n) => n !== '--h2-color')) {
		assert.equal(result[name], '');
	}
});

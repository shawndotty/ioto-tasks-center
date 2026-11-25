import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { resolvePolishCapability } = await jiti.import(
	'../src/views/ioto-task/task-polish-capability.ts',
);

function makeApp(plugins) {
	return { plugins: { plugins } };
}

test('ioto-settings 插件缺失 → null', () => {
	assert.equal(resolvePolishCapability(makeApp({})), null);
	assert.equal(resolvePolishCapability({}), null);
});

test('aiService 为 null → null', () => {
	const app = makeApp({ 'ioto-settings': { serviceManager: { aiService: null } } });
	assert.equal(resolvePolishCapability(app), null);
});

test('没有 generatePlainText → null', () => {
	const app = makeApp({ 'ioto-settings': { serviceManager: { aiService: {} } } });
	assert.equal(resolvePolishCapability(app), null);
});

test('正常返回，且 this 绑定到 aiService', async () => {
	const aiService = {
		calls: 0,
		async generatePlainText(prompt) {
			this.calls += 1;
			return { ok: true, text: `ok:${prompt}` };
		},
	};
	const app = makeApp({ 'ioto-settings': { serviceManager: { aiService } } });

	const capability = resolvePolishCapability(app);
	assert.ok(capability);

	const result = await capability.generatePlainText('hello');
	assert.deepEqual(result, { ok: true, text: 'ok:hello' });
	assert.equal(aiService.calls, 1);
});
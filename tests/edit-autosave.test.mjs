import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createAutosaveScheduler } = await jiti.import(
	'../src/views/ioto-task/edit-autosave.ts',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('持续 schedule：截止期不后移，只跑一次', async () => {
	let runs = 0;
	const s = createAutosaveScheduler(() => runs++, 40);
	s.schedule();
	await sleep(20);
	s.schedule(); // 等待中 → 忽略，不应把截止期推到 60ms
	await sleep(30); // t≈50：第一次应已触发
	assert.equal(runs, 1);
	s.dispose();
});

test('间隔结束后可再次触发（不是一次性）', async () => {
	let runs = 0;
	const s = createAutosaveScheduler(() => runs++, 20);
	s.schedule();
	await sleep(40);
	s.schedule();
	await sleep(40);
	assert.equal(runs, 2);
	s.dispose();
});

test('cancel：撤掉待写，不再触发', async () => {
	let runs = 0;
	const s = createAutosaveScheduler(() => runs++, 20);
	s.schedule();
	assert.equal(s.pending, true);
	s.cancel();
	assert.equal(s.pending, false);
	await sleep(40);
	assert.equal(runs, 0);
	s.dispose();
});

test('dispose：之后 schedule 无效（视图已卸载不再写盘）', async () => {
	let runs = 0;
	const s = createAutosaveScheduler(() => runs++, 20);
	s.dispose();
	s.schedule();
	await sleep(40);
	assert.equal(runs, 0);
});

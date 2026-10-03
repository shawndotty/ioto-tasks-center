import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	captureIotoTaskScroll,
	restoreIotoTaskScroll,
	pickAnchorIndex,
} = await jiti.import('../src/views/ioto-task/ioto-task-scroll.ts');

function makeCard(line, top, bottom) {
	return {
		getAttribute: (name) => (name === 'data-line' ? String(line) : null),
		getBoundingClientRect: () => ({ top, bottom }),
	};
}

function makeContainer({ scrollEl, cards = [] } = {}) {
	return {
		querySelector: (selector) =>
			selector.includes('data-line') ? null : scrollEl,
		querySelectorAll: () => cards,
	};
}

test('pickAnchorIndex：全部在视口下方取第 0 张', () => {
	assert.equal(pickAnchorIndex([100, 200], [140, 240], 0), 0);
});

test('pickAnchorIndex：取首个底边越过容器顶部的卡片', () => {
	assert.equal(pickAnchorIndex([-300, -100, 50], [-260, -60, 90], 0), 2);
});

test('pickAnchorIndex：全部在视口上方返回 null', () => {
	assert.equal(pickAnchorIndex([-300, -200], [-260, -160], 0), null);
});

test('captureIotoTaskScroll：无容器 / 无卡片时 anchorLine=null 且走 fallback', () => {
	assert.deepEqual(captureIotoTaskScroll(null, 128), {
		scrollTop: 128,
		anchorLine: null,
		anchorOffset: 0,
	});

	const noCardScrollEl = { scrollTop: 640, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
	assert.deepEqual(
		captureIotoTaskScroll(makeContainer({ scrollEl: noCardScrollEl }), 256),
		{ scrollTop: 256, anchorLine: null, anchorOffset: 0 },
	);
});

test('captureIotoTaskScroll：按首个进入视口的卡片记录锚点与偏移', () => {
	const scrollEl = {
		scrollTop: 900,
		getBoundingClientRect: () => ({ top: 40, bottom: 640 }),
	};
	const container = makeContainer({
		scrollEl,
		cards: [makeCard(12, -120, -80), makeCard(24, 76, 116)],
	});

	assert.deepEqual(captureIotoTaskScroll(container), {
		scrollTop: 900,
		anchorLine: 24,
		anchorOffset: 36,
	});
});

test('restoreIotoTaskScroll：把 scrollTop 写回滚动容器', () => {
	const scrollEl = { scrollTop: 0 };
	restoreIotoTaskScroll(makeContainer({ scrollEl }), {
		scrollTop: 412,
		anchorLine: null,
		anchorOffset: 0,
	});

	assert.equal(scrollEl.scrollTop, 412);
});

test('restoreIotoTaskScroll：锚点偏移 > 1px 时按 delta 纠偏', () => {
	const scrollEl = {
		scrollTop: 0,
		getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
	};
	const card = makeCard(5, 20, 60);
	const container = {
		querySelector: (selector) =>
			selector.includes('data-line') ? card : scrollEl,
		querySelectorAll: () => [card],
	};

	restoreIotoTaskScroll(container, {
		scrollTop: 100,
		anchorLine: 5,
		anchorOffset: 0,
	});

	// delta = card.top(20) - scroll.top(0) - anchorOffset(0) = 20 → 100 + 20
	assert.equal(scrollEl.scrollTop, 120);
});

test('restoreIotoTaskScroll：rAF 会再次纠偏（用假 rAF 捕获调用）', () => {
	const previousWindow = globalThis.window;
	const callbacks = [];
	globalThis.window = {
		requestAnimationFrame: (callback) => {
			callbacks.push(callback);
			return callbacks.length;
		},
	};

	try {
		const scrollEl = {
			scrollTop: 0,
			getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
		};
		const card = makeCard(7, 30, 70);
		const container = {
			querySelector: (selector) =>
				selector.includes('data-line') ? card : scrollEl,
			querySelectorAll: () => [card],
		};

		restoreIotoTaskScroll(container, {
			scrollTop: 50,
			anchorLine: 7,
			anchorOffset: 0,
		});
		assert.equal(scrollEl.scrollTop, 80);
		assert.equal(callbacks.length, 1);

		// 模拟下一帧布局再次偏移：rAF 回调应把 scrollTop 再纠一次
		scrollEl.scrollTop = 10;
		callbacks[0]();
		assert.equal(scrollEl.scrollTop, 80);
	} finally {
		if (previousWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	}
});

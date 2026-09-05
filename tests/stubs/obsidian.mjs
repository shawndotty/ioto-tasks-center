// obsidian 依赖只提供 .d.ts，没有运行时代码。
// 这里给出单测所需的最小可实例化实现，仅供 task-note-menu 相关测试使用。

// Obsidian 运行环境始终存在 window 全局；补一个最小实现，
// 让源码里按 lint 规则写的 window.setTimeout 等在 Node 测试里也能运行。
if (typeof globalThis.window === 'undefined') {
	globalThis.window = globalThis;
}

export class TAbstractFile {
	constructor(path) {
		this.path = path;
		this.name = path.split('/').pop() ?? '';
	}
}

export class TFile extends TAbstractFile {
	constructor(path) {
		super(path);
		this.extension = this.name.includes('.')
			? (this.name.split('.').pop() ?? '')
			: '';
		this.basename = this.name.replace(/\.[^.]+$/, '');
	}
}

export class TFolder extends TAbstractFile {}

export class Menu {}

export class Notice {
	constructor(message) {
		this.message = message;
	}
}

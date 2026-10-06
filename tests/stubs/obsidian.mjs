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

// 供 item-control-bridge 的 shim 判据使用（`type === MarkdownView`）。
// 真实 Obsidian 里 MarkdownView 与各插件共用同一模块实例，这里用单例类模拟。
export class MarkdownView {}

export class Notice {
	constructor(message) {
		this.message = message;
	}
}

// 以下为「视图宿主生命周期」测试加载 iotoTaskView.ts 所需的最小运行时实现。
// 真实的 TextFileView 在 Obsidian 运行时由文件视图基类提供，这里只保留可继承的空壳。
export class TextFileView {}

export const Platform = {
	isMobile: false,
	isDesktop: true,
	isPhone: false,
	isTablet: false,
};

export const MarkdownRenderer = {
	render: async () => {},
};

export const setIcon = () => {};

// 以下为「视图宿主生命周期」测试加载 iotoTaskView.ts 所需的最小 UI 类。
// iotoTaskView 静态引入了条目模板弹窗（entryTemplateModals / entryTemplateEditModal），
// 这些弹窗继承 / 实例化 obsidian 的 UI 组件；测试只需 import 成功，不触发其运行路径。
class FakeElement {
	empty() {}
	createEl() {
		return new FakeElement();
	}
	createDiv() {
		return new FakeElement();
	}
	createSpan() {
		return new FakeElement();
	}
}

export class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = new FakeElement();
	}
	open() {}
	close() {}
	setTitle() {}
}

export class Setting {
	constructor() {}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	setClass() {
		return this;
	}
	addButton() {
		return this;
	}
	addText() {
		return this;
	}
	addTextArea() {
		return this;
	}
	addToggle() {
		return this;
	}
	addDropdown() {
		return this;
	}
}

export class ButtonComponent {
	constructor() {}
	setButtonText() {
		return this;
	}
	setCta() {
		return this;
	}
	setClass() {
		return this;
	}
	onClick() {
		return this;
	}
}

export class TextComponent {}
export class TextAreaComponent {}
export class DropdownComponent {}
export class ToggleComponent {}

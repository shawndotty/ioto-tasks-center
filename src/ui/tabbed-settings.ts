// 记住每个命名容器当前激活的 tab 索引：
// - 有 memoryKey 的实例（顶层设置页 / 模板嵌套层）按稳定 key 记忆，
//   与实例化顺序无关，嵌套 TabbedSettings 不会互相错位；
// - 未命名的实例退化为按实例化顺序记忆（需配合 resetTabInstanceCounter）。
const namedTabIndices = new Map<string, number>();
const activeTabIndices: number[] = [];
let instanceCounter = 0;

interface TabEntry {
	tab: HTMLElement;
	callback: (content: HTMLElement) => void;
}

export class TabbedSettings {
	private tabs: HTMLElement;
	private content: HTMLElement;
	private instanceIndex: number;
	private entries: TabEntry[] = [];
	private activationScheduled = false;

	constructor(
		private container: HTMLElement,
		private memoryKey?: string,
	) {
		this.tabs = container.createDiv('settings-tabs');
		this.content = container.createDiv('settings-content');
		this.instanceIndex = instanceCounter++;
	}

	private get rememberedIndex(): number | undefined {
		return this.memoryKey
			? namedTabIndices.get(this.memoryKey)
			: activeTabIndices[this.instanceIndex];
	}

	private remember(index: number): void {
		if (this.memoryKey) namedTabIndices.set(this.memoryKey, index);
		else activeTabIndices[this.instanceIndex] = index;
	}

	addTab(name: string, callback: (content: HTMLElement) => void) {
		const tab = this.tabs.createDiv('settings-tab');
		tab.setText(name);
		const tabIndex = this.entries.length;
		this.entries.push({ tab, callback });
		tab.onclick = () => this.activate(tabIndex);
		// tab 都在同一同步批次内添加完；统一延后到微任务决策激活哪个 tab，
		// 这样才能对记忆索引做 clamp（tab 数减少时回退到最后一个，而不是空白页）
		this.scheduleActivation();
	}

	private activate(tabIndex: number) {
		const entry = this.entries[tabIndex];
		if (!entry) return;
		this.tabs
			.querySelectorAll('.settings-tab')
			.forEach((t) => t.removeClass('active'));
		this.content.empty();
		// 切 tab 后回到内容顶部。顶层实例的 container 就是 Obsidian 的滚动容器
		// （.vertical-tab-content）；嵌套实例的 container 不是滚动容器，赋值是安全 no-op。
		// 必须在 callback 重绘之前设置：empty() 与 callback() 在同一同步批次内完成，
		// 浏览器观察不到「内容变空」的中间态，不会自动把 scrollTop 夹回 0。
		this.container.scrollTop = 0;
		entry.tab.addClass('active');
		// 窄屏横向滚动 tab 条：激活项自动滚入视野（完全可见时不滚动，
		// block:nearest 避免设置页整体纵向滚动跳动）
		entry.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		this.remember(tabIndex);
		entry.callback(this.content);
	}

	private scheduleActivation() {
		if (this.activationScheduled) return;
		this.activationScheduled = true;
		queueMicrotask(() => {
			this.activationScheduled = false;
			if (this.entries.length === 0) return;
			// 首次（无记忆）默认第一个 tab；有记忆则 clamp 防越界
			const index = Math.min(
				this.rememberedIndex ?? 0,
				this.entries.length - 1,
			);
			this.activate(index);
		});
	}
}

// 每次 display() 开始前重置实例计数器（由 settings-tab 调用；仅影响未命名实例）
export function resetTabInstanceCounter() {
	instanceCounter = 0;
}

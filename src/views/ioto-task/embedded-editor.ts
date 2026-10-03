/* eslint-disable @typescript-eslint/no-explicit-any,
   @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-return,
   @typescript-eslint/no-unnecessary-type-assertion */
/**
 * 内嵌「核心 Markdown 编辑器」（[[Plan-20261003-073911]] §5.4）。
 *
 * 唯一接触 Obsidian 未公开内部 API 的文件：所有 `any`、所有 `try/catch` 都收在这里，
 * 其余模块不碰 `embedRegistry` / `editMode` / `buildLocalExtensions`。
 *
 * 机制照抄 obsidian-kanban：
 *   1. 借 `app.embedRegistry.embedByExtension.md(...)` 造一个临时 Markdown 编辑器，
 *      从 `md.editMode` 上溯两层原型拿到核心编辑器类，立刻 `unload()`；
 *   2. 子类化它以继承全套核心扩展 → 原生 `[[` / `#` 补全、Live Preview、IME；
 *   3. 伪造一个 `MarkdownFileInfo` 风格的 controller 喂给构造函数；
 *   4. 在 `focus` 里把 `app.workspace.activeEditor` 指向 controller（漏掉就没有补全弹窗）。
 *
 * 探测 / 取类失败一律返回 `null`，调用方走「切回 Markdown」降级，绝不报错、绝不白屏。
 */

import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { App, Component, TFile } from 'obsidian';

function noop(): void {
	/* intentionally empty */
}

/** 纯判断：注册表里有没有 markdown embed 构造器（注入假对象即可单测）。 */
export function isEmbeddedEditorSupported(registry: unknown): boolean {
	return Boolean((registry as any)?.embedByExtension?.md);
}

export function probeEmbeddedEditorSupport(app: App): boolean {
	try {
		return isEmbeddedEditorSupported((app as any).embedRegistry);
	} catch {
		return false;
	}
}

/**
 * 抢焦点的浮层容器：核心 Modal（含 ioto-settings 的 FuzzySuggestModal）/
 * 核心建议器 / 建议器主体。集中一处，便于随核心版本或 Phase 2 卡片右键菜单增补。
 */
export const OVERLAY_FOCUS_SELECTOR =
	'.modal-container, .suggestion-container, .prompt';

/**
 * 纯判断：给定 `document.activeElement`，是否落在会抢焦点的浮层里。
 * 用最小结构接口（只依赖 closest）以便假对象单测，不 import obsidian、不触 DOM。
 */
export function isOverlayFocusTarget(
	el: { closest?: (selector: string) => unknown } | null | undefined,
): boolean {
	if (!el || typeof el.closest !== 'function') {
		return false;
	}
	try {
		return Boolean(el.closest(OVERLAY_FOCUS_SELECTOR));
	} catch {
		return false;
	}
}

let cachedEditorClass: any = null;
let probeFailed = false;

/** 懒取核心编辑器类，进程内只成功取一次；失败也缓存失败结果，避免每次点卡片都重试。 */
export function getCoreMarkdownEditorClass(app: App): any {
	if (cachedEditorClass) {
		return cachedEditorClass;
	}
	if (probeFailed) {
		return null;
	}

	try {
		const md = (app as any).embedRegistry.embedByExtension.md(
			{ app, containerEl: createDiv(), state: {} },
			null,
			'',
		);
		md.load();
		md.editable = true;
		md.showEditor();
		const MarkdownEditor = Object.getPrototypeOf(
			Object.getPrototypeOf(md.editMode),
		).constructor;
		md.unload();
		cachedEditorClass = MarkdownEditor;
		return cachedEditorClass;
	} catch (error) {
		console.error(
			'[IOTO Task] 无法解析核心 Markdown 编辑器类，内联编辑将降级',
			error,
		);
		probeFailed = true;
		return null;
	}
}

export interface EmbeddedEditorHandle {
	getValue(): string;
	setValue(value: string): void;
	focus(): void;
	destroy(): void;
}

export interface EmbeddedEditorKeyboardHandlers {
	/** Enter：返回 true 表示已接管（提交 / 新建），false 放行给核心 */
	onEnter: (cm: EditorView) => boolean;
	/** 正文为空时的 Backspace：返回 true 表示已接管（删除该行） */
	onDeleteEmpty: (cm: EditorView) => boolean;
	/** Tab / Shift+Tab 缩进：返回 true 表示已接管 */
	onIndent: (delta: number, cm: EditorView) => boolean;
	/** Esc：取消编辑 */
	onEscape: (cm: EditorView) => void;
	/** 失焦：触发提交 */
	onBlur: () => void;
}

export interface MountEmbeddedEditorOptions {
	app: App;
	/** 卡片正文区（编辑器挂点） */
	hostEl: HTMLElement;
	/** 用 component.addChild / removeChild 托管编辑器生命周期 */
	component: Component;
	file: TFile;
	initialValue: string;
	handlers: EmbeddedEditorKeyboardHandlers;
}

/**
 * Kanban 同款：给编辑器一个「app 代理」，把 `vault.config` 的行号 / 折叠开关强制关掉，
 * 避免核心编辑器在卡片里显示行号栏或折叠箭头。
 */
function createEditorAppProxy(app: App): App {
	try {
		return new Proxy(app as any, {
			get(target, prop, receiver) {
				if (prop === 'vault') {
					return new Proxy((target as any).vault, {
						get(vaultTarget, vaultProp, vaultReceiver) {
							if (vaultProp === 'config') {
								return new Proxy(
									(vaultTarget as any).config,
									{
										get(configTarget, configProp, configReceiver) {
											if (
												[
													'showLineNumber',
													'foldHeading',
													'foldIndent',
												].includes(configProp as string)
											) {
												return false;
											}
											return Reflect.get(
												configTarget,
												configProp,
												configReceiver,
											);
										},
									},
								);
							}
							return Reflect.get(
								vaultTarget,
								vaultProp,
								vaultReceiver,
							);
						},
					});
				}
				return Reflect.get(target, prop, receiver);
			},
		}) as App;
	} catch {
		return app;
	}
}

export async function mountEmbeddedEditor(
	options: MountEmbeddedEditorOptions,
): Promise<EmbeddedEditorHandle | null> {
	const CoreClass = getCoreMarkdownEditorClass(options.app);
	if (!CoreClass) {
		return null;
	}

	const { app, hostEl, component, file, initialValue, handlers } = options;

	try {
		const appProxy = createEditorAppProxy(app);
		let editorInstance: any = null;
		let destroyed = false;
		let blurred = false;
		let previousActiveEditor: unknown = null;

		const controller: any = {
			app: appProxy,
			showSearch: noop,
			toggleMode: noop,
			onMarkdownScroll: noop,
			getMode: () => 'source',
			scroll: 0,
			editMode: null,
			get editor() {
				return editorInstance?.editor ?? null;
			},
			get file() {
				return file;
			},
			get path() {
				return file.path;
			},
		};

		// 🔴 焦点登记：不设 activeEditor 就没有 [[ / # 补全弹窗与移动端工具栏。
		// 挂载时立即登记一次（不依赖 focus 事件，因为窗口未获焦时 focus 可能不派发），
		// 并在 focus 里再登记；Kanban 同款延后一拍再登记，防止核心把它重置。
		let hasCapturedPrevious = false;
		const registerActiveEditor = () => {
			if (blurred || destroyed) {
				return;
			}
			if (!hasCapturedPrevious) {
				try {
					previousActiveEditor =
						(app.workspace as any).activeEditor ?? null;
				} catch {
					previousActiveEditor = null;
				}
				hasCapturedPrevious = true;
			}
			try {
				(app.workspace as any).activeEditor = controller;
			} catch {
				/* ignore */
			}
			window.setTimeout(() => {
				if (blurred || destroyed) {
					return;
				}
				try {
					(app.workspace as any).activeEditor = controller;
				} catch {
					/* ignore */
				}
			}, 0);
		};

		// 用类表达式 + `any` 承接：核心编辑器类的构造签名 / 原型方法都不可静态得知。
		const IotoTaskEmbeddedEditor: any = class extends (CoreClass as any) {
			isIotoTaskEditor = true;

			buildLocalExtensions(): Extension[] {
				const coreExtensions: Extension[] = [
					...(super.buildLocalExtensions?.() ?? []),
				];
				// 我们的 keymap 必须排在核心扩展**之前**：同为 Prec.highest 时，
				// CM6 按扩展在数组里的先后决定优先级，排在后面会被核心的 Enter 抢走。
				const extensions: Extension[] = [];

				extensions.push(
					Prec.highest(
						EditorView.domEventHandlers({
							focus: () => {
								blurred = false;
								registerActiveEditor();
								return false;
							},
							blur: () => {
								// 弹窗（如 ioto-settings 的出链 FuzzySuggestModal）会抢焦点，
								// 但 Obsidian 在弹窗关闭后会把焦点还给进入前的元素
								// （Research-20261003-100337 §3.3）。因此延后一拍再看焦点去向：
								// 落进浮层就整体放行（不提交 / 不销毁 / 不还原 activeEditor），
								// 否则按「真正离开」提交。期间不置 blurred=true，保护
								// registerActiveEditor 挂载时那次 setTimeout 的再登记不被短路。
								window.setTimeout(() => {
									if (destroyed) {
										return;
									}
									const activeEl =
										hostEl.ownerDocument
											?.activeElement ?? null;
									if (isOverlayFocusTarget(activeEl)) {
										return;
									}
									blurred = true;
									try {
										if (
											(app.workspace as any)
												.activeEditor === controller
										) {
											(app.workspace as any).activeEditor =
												previousActiveEditor;
										}
									} catch {
										/* ignore */
									}
									handlers.onBlur();
								}, 0);
								return false;
							},
						}),
					),
				);

				return [...extensions, ...coreExtensions];
			}

			updateBottomPadding(): void {
				/* 卡片内不需要核心的底部留白 */
			}
		};

		const editor = new IotoTaskEmbeddedEditor(
			appProxy,
			hostEl,
			controller,
		) as any;
		editorInstance = editor;
		component.addChild(editor);
		controller.editMode = editor;
		editor.set(initialValue ?? '');
		// 进入编辑时把光标放到正文末尾，符合「点开继续写」的直觉。
		try {
			const end = editor.cm.state.doc.length;
			editor.cm.dispatch({ selection: { anchor: end, head: end } });
		} catch {
			/* ignore */
		}
		// 点卡片即视为进入编辑：立刻把 activeEditor 登记到本 controller。
		registerActiveEditor();

		// 核心编辑器的 Enter 有自己的 keymap（同为 Prec.highest 时排在前面，会吃掉
		// 我们的 CM6 keymap），因此改用 hostEl 上的**捕获阶段** keydown：抢在核心之前
		// 拦截我们关心的 4 个键；补全弹窗打开时全部放行（Enter 选中 / Esc 关弹窗 / Tab 翻页）。
		const isSuggestionOpen = () =>
			Boolean(hostEl.ownerDocument?.querySelector('.suggestion-container'));

		const onHostKeyDown = (event: KeyboardEvent) => {
			// IME 组合输入期间一律放行（组合中的 Enter/Tab 不该被我们接管）
			if (event.isComposing) {
				return;
			}
			const cm = editor?.cm as EditorView | undefined;
			if (!cm) {
				return;
			}
			if (isSuggestionOpen()) {
				return;
			}

			switch (event.key) {
				case 'Enter':
					// 带主修饰键 / Alt 的 Enter 不按「新建同级」处理：
					// 放行后由外层（或核心）决定，避免 Cmd+Enter 被当普通 Enter 拆行
					// （[[Plan-20261003-222709]] §四.4）。
					if (event.metaKey || event.ctrlKey || event.altKey) {
						break;
					}
					if (handlers.onEnter(cm)) {
						event.preventDefault();
						event.stopPropagation();
					}
					break;
				case 'Backspace':
					if (
						cm.state.doc.length === 0 &&
						handlers.onDeleteEmpty(cm)
					) {
						event.preventDefault();
						event.stopPropagation();
					}
					break;
				case 'Tab':
					if (handlers.onIndent(event.shiftKey ? -1 : 1, cm)) {
						event.preventDefault();
						event.stopPropagation();
					}
					break;
				case 'Escape':
					handlers.onEscape(cm);
					event.preventDefault();
					event.stopPropagation();
					break;
				default:
					break;
			}
		};
		hostEl.addEventListener('keydown', onHostKeyDown, true);

		const getEditorValue = (): string => {
			try {
				if (editor?.cm?.state?.doc) {
					return editor.cm.state.doc.toString();
				}
			} catch {
				/* ignore */
			}
			return '';
		};

		const destroy = () => {
			if (destroyed) {
				return;
			}
			destroyed = true;
			try {
				hostEl.removeEventListener('keydown', onHostKeyDown, true);
			} catch {
				/* ignore */
			}
			try {
				if ((app.workspace as any).activeEditor === controller) {
					(app.workspace as any).activeEditor = previousActiveEditor;
				}
			} catch {
				/* ignore */
			}
			try {
				component.removeChild(editor);
			} catch {
				/* ignore */
			}
			try {
				hostEl.empty();
			} catch {
				/* ignore */
			}
		};

		return {
			getValue: getEditorValue,
			setValue: (value: string) => {
				try {
					editor.set(value ?? '');
				} catch {
					/* ignore */
				}
			},
			focus: () => {
				try {
					editor.focus();
				} catch {
					/* ignore */
				}
			},
			destroy,
		};
	} catch (error) {
		console.error('[IOTO Task] 挂载内嵌编辑器失败，已降级', error);
		try {
			hostEl.empty();
		} catch {
			/* ignore */
		}
		return null;
	}
}

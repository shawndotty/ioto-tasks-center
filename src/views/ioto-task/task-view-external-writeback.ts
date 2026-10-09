import type { IOTOTaskView } from '../iotoTaskView';

/**
 * 视图级「编辑落盘」原语：把**标题**与**续写**两个编辑器都提交到磁盘。
 *
 * 供「执行任务」命令族在派发**前**调用（`item-control-bridge` 拦截层），
 * 因为 `ioto-settings` 的 `saveActiveNote` 只认 `MarkdownView`、会跳过
 * IOTOTask（`TextFileView`），若不落盘，Agent 的 `vault.read` 读到的是旧正文
 * （[[Discuss-20261006-150839]] §一）。
 *
 * 两个 `commit*` 在无编辑态时各自短路（幂等），故可无条件调用：
 * 无待写内容 → 不写盘、不加延迟（§四 Q3 默认「直通」）。
 */
export async function flushInlineEdits(view: IOTOTaskView): Promise<void> {
	await view.commitEdit();
	await view.commitContinuationEdit();
}

/**
 * 桥接层调用：开启「外部写回窗口」（[[Research-20261008-105532]] 方案 A）。
 * 未处于任一编辑态（标题 / 续行）→ 返回 false，桥接层原样透传。
 */
export function beginExternalEditorWriteback(view: IOTOTaskView): boolean {
	if (view.editingLine === null && view.continuationLine === null) {
		return false;
	}
	view.externalWritebackActive = true;
	view.externalWritebackBlurred = false;
	view.externalWritebackDirty = false;
	// 窗口内不自动落盘：写回与退出统一由 endExternalEditorWriteback 收口，
	// 避免模板中途写盘先销毁编辑器（方案 A 的反向风险）。
	view.autosave.cancel();
	return true;
}

/**
 * 桥接层调用：命令结束（无论成败）关闭窗口。
 * 期间发生过 blur（换视图）或内容变更（模板写回）→ 补一次落盘：
 * 把含回填链接的最新正文写盘 + **保持编辑态**（与 v256 / `flushZoomEdit` 同口径）。
 *
 * `[[Plan-20261008-184418]]` 方案 A：终止动作由 `commitEdit`（提交并退出编辑）改为
 * `autosaveEdit`（只落盘、保持编辑）。不改窗口机制、不加开关、不动数据。
 */
export function endExternalEditorWriteback(view: IOTOTaskView): void {
	if (!view.externalWritebackActive) {
		return;
	}
	const shouldFlush =
		view.externalWritebackBlurred || view.externalWritebackDirty;
	view.externalWritebackActive = false;
	view.externalWritebackBlurred = false;
	view.externalWritebackDirty = false;
	if (!shouldFlush) {
		return;
	}
	// 写回窗口关闭 = 只落盘、不退出编辑态（与 v256 / flushZoomEdit 同口径）：
	// 链接照旧写盘，卡片保持 .is-editing，不再回落成裸 .is-selected。
	// autosaveEdit 不 destroy、不清 editingLine、不 refreshCard，并会刷新
	// editingOriginalLine，不给下一次提交留假 conflict（[[Report-20261008-183809]]）。
	void view.autosaveEdit();
}

/**
 * 任务描述润色的 prompt 层（Plan-20261125-210407 §4.2；Plan-20261126-063235 §3.2）。
 *
 * 纯函数：交付物 token 收集 + prompt 构建。`@[[交付物]]` 随正文一起进模型，
 * 由输出层的白名单对账保证不丢失、不多出。
 */

const DELIVERABLE_TOKEN_PATTERN = /@\[\[[^\]]+\]\]/g;

/** 按出现顺序收集正文中的 `@[[…]]` 原始 token（含别名、含重复次数，逐字节保留）。 */
export function collectDeliverableTokens(body: string): string[] {
	const matches = body.match(DELIVERABLE_TOKEN_PATTERN);
	return matches ?? [];
}

export function buildPolishPrompt(body: string): string {
	const deliverables = [...new Set(collectDeliverableTokens(body))];
	const contextLines = [
		'- 这是 Obsidian 任务清单里的一条任务（一行一条）。',
		'- 可以用 <br> 换行；不要写成标题、列表块或代码块。',
	];
	if (deliverables.length > 0) {
		contextLines.push(`- 本行的交付物：${deliverables.join('、')}`);
	}

	return [
		'你是一名中文任务描述编辑。你的唯一任务是润色下面这条任务描述，不执行任务、不新增事实。',
		'',
		'[任务描述]',
		body,
		'',
		'[已知上下文]',
		...contextLines,
		'',
		'[要求]',
		'1. 保持原意，不臆造人名、日期、数字、链接、结论；无法确定处写「（待补充：…）」。',
		'2. 原样保留所有 [[链接]]、@[[交付物]] 标记、`代码`、命令、专有名词、数字。',
		'3. 补齐可推断的要素（对象、范围、完成标准），把口语化表达改为规范书面语。',
		'4. 有结构需求时用分号或「1) 2)」在同一句内分层，不要堆砌小标题。',
		'5. 长度不超过原文的 2 倍，且不超过 500 字。',
		'6. 只输出润色后的描述正文：不要解释、不要前缀（如「润色后：」）、不要引号、不要代码围栏。',
		'7. 每个 @[[…]] 交付物标记必须原样保留（含 @ 前缀、笔记名与别名），留在原句位置；不得删除、新增或改写。',
	].join('\n');
}
/**
 * 任务描述润色的 prompt 层（Plan-20261125-210407 §4.2）。
 *
 * 纯函数：交付物尾剥离 + prompt 构建。`@[[交付物]]` 不参与润色，
 * 但必须原样拼回（入口剥离 / 出口拼回），链接集合由输出校验硬兜底。
 */

export interface SplitDeliverableTail {
	/** 发给模型的部分（已去掉尾部交付物子句） */
	prose: string;
	/** 原样拼回的尾部（无则为 `""`） */
	trailingDeliverables: string;
}

const DELIVERABLE_TAIL_PATTERN = /(?:\s*@\[\[[^\]]+\]\])+\s*$/;

export function splitDeliverableTail(body: string): SplitDeliverableTail {
	const match = DELIVERABLE_TAIL_PATTERN.exec(body);
	if (!match) {
		return { prose: body.trimEnd(), trailingDeliverables: '' };
	}

	return {
		prose: body.slice(0, match.index).trimEnd(),
		trailingDeliverables: match[0].trim(),
	};
}

export function buildPolishPrompt(prose: string): string {
	return [
		'你是一名中文任务描述编辑。你的唯一任务是润色下面这条任务描述，不执行任务、不新增事实。',
		'',
		'[任务描述]',
		prose,
		'',
		'[已知上下文]',
		'- 这是 Obsidian 任务清单里的一条任务（一行一条）。',
		'- 可以用 <br> 换行；不要写成标题、列表块或代码块。',
		'',
		'[要求]',
		'1. 保持原意，不臆造人名、日期、数字、链接、结论；无法确定处写「（待补充：…）」。',
		'2. 原样保留所有 [[链接]]、`代码`、命令、专有名词、数字。',
		'3. 补齐可推断的要素（对象、范围、完成标准），把口语化表达改为规范书面语。',
		'4. 有结构需求时用分号或「1) 2)」在同一句内分层，不要堆砌小标题。',
		'5. 长度不超过原文的 2 倍，且不超过 500 字。',
		'6. 只输出润色后的描述正文：不要解释、不要前缀（如「润色后：」）、不要引号、不要代码围栏。',
	].join('\n');
}
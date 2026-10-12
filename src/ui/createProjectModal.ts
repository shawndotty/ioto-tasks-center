import { ButtonComponent, Modal, TextComponent } from 'obsidian';
import { t } from '../lang/helpter';
import { TaskNameModal } from './taskNameModal';

/** 分类下拉末项哨兵：选中表示「就地新建分类」。与项目中心既有下拉共用同一约定。 */
const ADD_NEW_CATEGORY_VALUE = '__ioto_add__';

export interface CreateProjectResult {
	name: string;
	/** null = 未分类（留空）。 */
	category: string | null;
}

interface CreateProjectModalOptions {
	descriptionText?: string;
	confirmButtonText?: string;
	/** 有效分类集合（调用方用 collectCategoryOptions 算好，已是去重排序结果）。 */
	categoryOptions: string[];
}

/**
 * 「添加项目」弹窗：在收项目名的基础上增加「项目分类」选择控件。
 *
 * 分类可留空（＝未分类）、可选已有、可经末项哨兵就地新建。
 * 弹窗内新建的分类**只进下拉选项**，不做任何持久化——设置字典的写入
 * 统一延迟到「建目录成功之后」的编排 helper 里（避免建失败留孤儿分类）。
 */
export class CreateProjectModal extends Modal {
	private readonly titleText: string;
	private readonly descriptionText: string;
	private readonly confirmButtonText: string;
	private readonly categoryOptions: string[];
	private nameInput: TextComponent | null = null;
	private categorySelectEl: HTMLSelectElement | null = null;
	/** 哨兵被选中时用于回退的「上一次有效分类值」。 */
	private lastCategoryValue = '';
	private resolvePromise:
		| ((value: CreateProjectResult | null) => void)
		| null = null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		titleText: string,
		options: CreateProjectModalOptions,
	) {
		super(app);
		this.titleText = titleText;
		this.descriptionText =
			options.descriptionText ?? t('modal.defaultDescription');
		this.confirmButtonText = options.confirmButtonText ?? t('modal.confirm');
		this.categoryOptions = options.categoryOptions;
	}

	openAndGetValue(): Promise<CreateProjectResult | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(this.titleText);

		const descriptionEl = this.contentEl.createEl('p', {
			text: this.descriptionText,
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		this.nameInput = new TextComponent(this.contentEl);
		this.nameInput.setPlaceholder(t('modal.newProject.placeholder'));
		this.nameInput.inputEl.addClass('ioto-tasks-center__modal-input');
		this.nameInput.inputEl.focus();
		this.nameInput.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.confirm();
			}
		});

		this.renderCategoryField();

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.cancel'))
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(this.confirmButtonText)
			.setCta()
			.onClick(() => this.confirm());
	}

	onClose(): void {
		this.nameInput = null;
		this.categorySelectEl = null;
		this.contentEl.empty();
		this.resolve(null);
	}

	private renderCategoryField(): void {
		const fieldEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-field',
		});
		fieldEl.createEl('label', {
			text: t('modal.newProject.categoryLabel'),
			cls: 'ioto-tasks-center__modal-label',
		});

		const selectEl = fieldEl.createEl('select', {
			cls: 'ioto-tasks-center__modal-select',
		});
		this.categorySelectEl = selectEl;

		selectEl.createEl('option', {
			value: '',
			text: t('projectCenter.category.empty'),
		});
		for (const option of this.categoryOptions) {
			selectEl.createEl('option', { value: option, text: option });
		}
		selectEl.createEl('option', {
			value: ADD_NEW_CATEGORY_VALUE,
			text: t('projectCenter.category.addNew'),
		});

		this.lastCategoryValue = selectEl.value;
		selectEl.addEventListener('change', () => {
			void this.handleCategorySelectChange();
		});
	}

	private async handleCategorySelectChange(): Promise<void> {
		const selectEl = this.categorySelectEl;
		if (!selectEl) {
			return;
		}
		if (selectEl.value !== ADD_NEW_CATEGORY_VALUE) {
			this.lastCategoryValue = selectEl.value;
			return;
		}

		// 选中哨兵：先回退到上一次有效值，再内联复用 TaskNameModal 收新分类名。
		selectEl.value = this.lastCategoryValue;

		const nameResult = await new TaskNameModal(
			this.app,
			t('projectCenter.category.addTitle'),
			t('projectCenter.category.addPlaceholder'),
			{
				descriptionText: t('projectCenter.category.addDesc'),
				confirmButtonText: t('modal.create'),
			},
		).openAndGetValue();

		const normalized = nameResult?.trim() ?? '';
		if (!normalized) {
			return;
		}

		let optionEl = Array.from(selectEl.options).find(
			(option) => option.value === normalized,
		);
		if (!optionEl) {
			optionEl = selectEl.createEl('option', {
				value: normalized,
				text: normalized,
			});
		}
		selectEl.value = normalized;
		this.lastCategoryValue = normalized;
	}

	private confirm(): void {
		const value = this.nameInput?.getValue().trim() ?? '';
		if (!value) {
			this.resolve(null);
			this.close();
			return;
		}

		const category = this.categorySelectEl?.value ?? '';
		this.resolve({
			name: value,
			category: category.length > 0 ? category : null,
		});
		this.close();
	}

	private resolve(value: CreateProjectResult | null): void {
		if (this.isResolved) {
			return;
		}

		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}

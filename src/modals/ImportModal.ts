import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class ImportModal extends FuzzySuggestModal<TFile> {
	onChoose: (file: TFile) => void;
	private filterString: string[] = [];

	constructor(
		app: App,
		onChoose: (file: TFile) => void,
		extraFilter?: string[],
	) {
		super(app);
		this.onChoose = onChoose;
		if (extraFilter) {
			this.filterString = [...this.filterString, ...extraFilter];
		}
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension === 'md')
			.filter((f) =>
				this.filterString.every((s) => f.basename.includes(s)),
			);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(file);
	}
}

import { App, TFile } from 'obsidian';

export async function trashTaskFile(app: App, file: TFile): Promise<void> {
	// Vault.trash() keeps compatibility with the current minAppVersion (1.1.0).
	// eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
	await app.vault.trash(file, true);
}

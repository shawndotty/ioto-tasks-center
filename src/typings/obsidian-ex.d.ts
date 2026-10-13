import type { Menu, TFile } from 'obsidian';
import 'obsidian';

declare module 'obsidian' {
	interface MenuItem {
		dom: HTMLElement;
		setSubmenu: () => Menu;
	}
	interface FileManager {
		promptForFileRename(file: TFile): void;
	}
}

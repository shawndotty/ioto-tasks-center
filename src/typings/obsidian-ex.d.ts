import type { Menu } from 'obsidian';
import 'obsidian';

declare module 'obsidian' {
	interface MenuItem {
		dom: HTMLElement;
		setSubmenu: () => Menu;
	}
}

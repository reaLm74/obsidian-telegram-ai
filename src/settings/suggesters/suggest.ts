// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes

import { AbstractInputSuggest, App } from "obsidian";

export abstract class TextInputSuggest<T> extends AbstractInputSuggest<T> {
	constructor(
		app: App,
		protected inputEl: HTMLInputElement | HTMLTextAreaElement,
	) {
		super(app, inputEl as HTMLInputElement);
	}

	abstract getSuggestions(inputStr: string): T[];
	abstract renderSuggestion(item: T, el: HTMLElement): void;
	abstract selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): void;
}

/**
 * Minimal mock of the Obsidian API for unit testing.
 * Only stubs used in tested modules are provided.
 */

export class Notice {
	constructor(_message: string, _timeout?: number) {}
	hide() {}
}

export class App {}

export class Plugin {
	app = new App();
	manifest = { name: "test-plugin", id: "test-plugin", version: "0.0.0" };
	async loadData() {
		return {};
	}
	async saveData(_data: unknown) {}
	/** Obsidian clears these on unload; here it only has to hand the id straight back. */
	registerInterval(id: number): number {
		return id;
	}
}

export class PluginSettingTab {
	containerEl = { empty: () => {}, createDiv: () => ({ addClass: () => {} }) };
	constructor(_app: App, _plugin: Plugin) {}
	display() {}
	hide() {}
	update() {}
	refreshDomState() {}
	getControlValue(_key: string): unknown {
		return undefined;
	}
	setControlValue(_key: string, _value: unknown) {}
}

/** Tests act as the newest Obsidian; override per test to simulate older hosts. */
export function requireApiVersion(_version: string): boolean {
	return true;
}

/** i18n's fallback locale probe; tests drive locale via initLocale() explicitly. */
export function getLanguage(): string {
	return "en";
}

export class Setting {
	settingEl = { remove: () => {} };
	descEl = { appendChild: () => {}, createSpan: () => {} };
	constructor(_containerEl: unknown) {}
	setName(_name: string) {
		return this;
	}
	setDesc(_desc: string) {
		return this;
	}
	setHeading() {
		return this;
	}
	addText(_cb: unknown) {
		return this;
	}
	addToggle(_cb: unknown) {
		return this;
	}
	addButton(_cb: unknown) {
		return this;
	}
	addDropdown(_cb: unknown) {
		return this;
	}
	addExtraButton(_cb: unknown) {
		return this;
	}
	addSlider(_cb: unknown) {
		return this;
	}
	addTextArea(_cb: unknown) {
		return this;
	}
}

export class Modal {
	contentEl = { empty: () => {}, createDiv: () => ({}) };
	constructor(_app: App) {}
	open() {}
	close() {}
}

export class TextComponent {
	setValue(_value: string) {
		return this;
	}
	setDisabled(_disabled: boolean) {
		return this;
	}
	setPlaceholder(_placeholder: string) {
		return this;
	}
	onChange(_cb: (value: string) => void) {
		return this;
	}
}

export class ButtonComponent {
	setButtonText(_text: string) {
		return this;
	}
	setClass(_cls: string) {
		return this;
	}
	setCta() {
		return this;
	}
	setIcon(_icon: string) {
		return this;
	}
	setTooltip(_tooltip: string) {
		return this;
	}
	setDisabled(_disabled: boolean) {
		return this;
	}
	onClick(_cb: () => void) {
		return this;
	}
}

export async function requestUrl(_options: unknown): Promise<{ status: number; json: unknown; text: string }> {
	return { status: 200, json: {}, text: "" };
}

/**
 * Minimal moment mock — wraps Date and supports .format()
 */
function momentMock(date?: Date | string | number) {
	const d = date ? new Date(date) : new Date();
	return {
		format(fmt: string): string {
			// Simple format implementation for common patterns used in templates
			const pad = (n: number, len = 2) => String(n).padStart(len, "0");
			const Y = d.getFullYear();
			const M = d.getMonth() + 1;
			const D = d.getDate();
			const H = d.getHours();
			const m = d.getMinutes();
			const s = d.getSeconds();
			const ms = d.getMilliseconds();
			return fmt
				.replace("YYYY", String(Y))
				.replace("YY", String(Y).slice(-2))
				.replace("MM", pad(M))
				.replace("DD", pad(D))
				.replace("HH", pad(H))
				.replace("mm", pad(m))
				.replace("ss", pad(s))
				.replace("SSS", pad(ms, 3));
		},
	};
}

export const moment = momentMock;

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/");
}

export class TFolder {
	path = "";
	name = "";
	children: unknown[] = [];
}

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
}

/**
 * Platform flags: tests run as "desktop" so the desktop-only gates (userGateway,
 * bot.ts's battery-saver guard) take their production desktop path by default.
 * A test simulating mobile can overwrite the flags directly.
 */
export const Platform = {
	isDesktopApp: true,
	isMobileApp: false,
	isMacOS: false,
	isMobile: false,
	isPhone: false,
	isTablet: false,
};

export function setIcon(_el: unknown, _icon: string): void {}

/** Obsidian's fuzzy-ish search: the mock matches a simple case-insensitive substring. */
export function prepareSimpleSearch(query: string): (text: string) => { score: number } | null {
	const needle = query.toLowerCase();
	return (text: string) => (text.toLowerCase().includes(needle) ? { score: 0 } : null);
}

export class TextAreaComponent {
	inputEl = { value: "", addClass: (_c: string) => undefined };
	setValue(value: string) {
		this.inputEl.value = value;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	setPlaceholder(_p: string) {
		return this;
	}
	onChange(_cb: (value: string) => void) {
		return this;
	}
}

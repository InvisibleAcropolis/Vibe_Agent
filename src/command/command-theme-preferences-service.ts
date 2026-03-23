import type { AppStateStore } from "../app-state-store.js";
import type { ShellMenuItem } from "../components/shell-menu-overlay.js";
import { getActiveTheme, getThemeNames, setActiveTheme, type ThemeName } from "../themes/index.js";
import type { CommandConfigStore } from "./command-types.js";

export class CommandThemePreferencesService {
	constructor(
		private readonly dependencies: {
			stateStore: AppStateStore;
			configStore: CommandConfigStore;
		},
	) {}

	createMenuItems(): ShellMenuItem[] {
		const active = getActiveTheme().name;
		return getThemeNames().map((themeName) => ({
			kind: "action" as const,
			id: `theme:${themeName}`,
			label: themeName === active ? `* ${themeName}` : themeName,
			description: themeName === active ? "Current theme" : "Apply theme",
			onSelect: () => this.handleThemeCommand(`/theme ${themeName}`),
		}));
	}

	handleThemeCommand(text: string): void {
		const arg = text.slice("/theme".length).trim();
		const themeNames = getThemeNames();
		if (!arg) {
			const active = getActiveTheme().name;
			const list = themeNames.map((name) => (name === active ? `> ${name}` : `  ${name}`)).join("  ");
			this.dependencies.stateStore.setStatusMessage(`Themes: ${list}`);
			return;
		}
		if (!themeNames.includes(arg as ThemeName)) {
			this.dependencies.stateStore.setStatusMessage(`Unknown theme "${arg}". Available: ${themeNames.join(", ")}`);
			return;
		}

		setActiveTheme(arg as ThemeName);
		this.dependencies.configStore.saveConfig({
			...this.dependencies.configStore.getConfig(),
			selectedTheme: arg,
		});
		this.dependencies.stateStore.setStatusMessage(`Theme set to "${arg}".`);
	}
}

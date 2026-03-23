import { Text, type Component, type Container, type TUI } from "@mariozechner/pi-tui";
import type { FooterDataProvider } from "../footer-data-provider.js";
import { getCodingAgentTheme } from "./shell-coding-agent-interop.js";
import type { FooterFactory, HeaderFactory, WidgetFactory } from "./shell-types.js";

export class ShellExtensionChrome {
	private readonly extensionWidgetsAbove = new Map<string, WidgetFactory>();
	private readonly extensionWidgetsBelow = new Map<string, WidgetFactory>();
	private customHeaderFactory?: HeaderFactory;
	private customFooterFactory?: FooterFactory;
	private customHeaderComponent?: Component & { dispose?(): void };
	private customFooterComponent?: Component & { dispose?(): void };

	constructor(
		private readonly dependencies: {
			tui: TUI;
			customHeaderContainer: Container;
			widgetContainerAbove: Container;
			widgetContainerBelow: Container;
			footerContentContainer: Container;
			chromeHeaderInfo: Text;
			footerData: FooterDataProvider;
			onDefaultHeaderRequested: () => void;
		},
	) {}

	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement: "aboveEditor" | "belowEditor" = "aboveEditor"): void {
		const target = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		if (!content) {
			target.delete(key);
			return;
		}
		if (Array.isArray(content)) {
			target.set(key, () => new Text(content.join("\n"), 1, 0));
			return;
		}
		target.set(key, content);
	}

	setHeaderFactory(factory: HeaderFactory | undefined): void {
		this.customHeaderFactory = factory;
		this.dependencies.customHeaderContainer.clear();
		this.customHeaderComponent?.dispose?.();
		this.customHeaderComponent = undefined;
		if (factory) {
			this.customHeaderComponent = factory(this.dependencies.tui, getCodingAgentTheme());
			this.dependencies.customHeaderContainer.addChild(this.customHeaderComponent);
			this.dependencies.chromeHeaderInfo.setText("");
			return;
		}
		this.dependencies.onDefaultHeaderRequested();
	}

	setFooterFactory(factory: FooterFactory | undefined): void {
		this.customFooterFactory = factory;
	}

	hasCustomHeaderFactory(): boolean {
		return !!this.customHeaderFactory;
	}

	renderFooterContent(): void {
		this.dependencies.footerContentContainer.clear();
		this.customFooterComponent?.dispose?.();
		this.customFooterComponent = undefined;
		if (!this.customFooterFactory) {
			return;
		}
		this.customFooterComponent = this.customFooterFactory(this.dependencies.tui, getCodingAgentTheme(), this.dependencies.footerData);
		this.dependencies.footerContentContainer.addChild(this.customFooterComponent);
	}

	renderWidgets(): void {
		this.dependencies.widgetContainerAbove.clear();
		for (const factory of this.extensionWidgetsAbove.values()) {
			this.dependencies.widgetContainerAbove.addChild(factory(this.dependencies.tui, getCodingAgentTheme()));
		}

		this.dependencies.widgetContainerBelow.clear();
		for (const factory of this.extensionWidgetsBelow.values()) {
			this.dependencies.widgetContainerBelow.addChild(factory(this.dependencies.tui, getCodingAgentTheme()));
		}
	}

	dispose(): void {
		this.customHeaderComponent?.dispose?.();
		this.customFooterComponent?.dispose?.();
	}
}

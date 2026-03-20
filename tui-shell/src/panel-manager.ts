import type { PanelContext, PanelDefinition, PanelInstance } from "./types.js";

export class PanelManager {
	private readonly definitions = new Map<string, PanelDefinition>();
	private readonly instances = new Map<string, PanelInstance>();
	private activePanelId: string | null = null;

	constructor(private readonly context: PanelContext) {}

	register(definition: PanelDefinition): void {
		this.definitions.set(definition.id, definition);
	}

	activate(id: string): PanelInstance {
		const definition = this.definitions.get(id);
		if (!definition) {
			throw new Error(`Unknown panel: ${id}`);
		}

		let instance = this.instances.get(id);
		if (!instance) {
			instance = definition.create(this.context);
			this.instances.set(id, instance);
		}

		this.activePanelId = id;
		return instance;
	}

	getActive(): PanelInstance {
		if (!this.activePanelId) {
			throw new Error("No active panel");
		}
		const panel = this.instances.get(this.activePanelId);
		if (!panel) {
			throw new Error(`Active panel missing: ${this.activePanelId}`);
		}
		return panel;
	}

	getActiveId(): string | null {
		return this.activePanelId;
	}

	listDefinitions(): PanelDefinition[] {
		return [...this.definitions.values()];
	}

	dispose(): void {
		for (const instance of this.instances.values()) {
			instance.dispose?.();
		}
		this.instances.clear();
		this.activePanelId = null;
	}
}

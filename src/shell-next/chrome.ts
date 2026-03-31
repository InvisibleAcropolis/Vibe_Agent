import type { ShellNextRenderModel } from "./renderer.js";

export interface ShellNextChrome {
	formatHeader(model: ShellNextRenderModel): string;
	formatStatus(model: ShellNextRenderModel): string;
}

export function createShellNextChrome(): ShellNextChrome {
	return {
		formatHeader: (model) => model.header,
		formatStatus: (model) => model.status,
	};
}

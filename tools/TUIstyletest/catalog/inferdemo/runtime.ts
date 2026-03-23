import type { StyleTestRuntime, StyleTestRuntimeContext } from "../../../../src/style-test-contract.js";
import type { StandardAnimationPattern } from "./types.js";

export function buildStandardRuntime(
	exportValue: unknown,
	pattern: StandardAnimationPattern,
	context: StyleTestRuntimeContext,
	options: Record<string, unknown> | undefined,
): StyleTestRuntime {
	if (typeof exportValue !== "function") {
		return {
			render() {
				return ["Export is not callable."];
			},
		};
	}
	if (pattern === "factory") {
		const created = exportValue(options);
		if (typeof created !== "function") {
			return {
				render() {
					return ["Factory export did not return a renderer."];
				},
			};
		}
		return {
			render() {
				const rendered = created(context.getAnimationState(), context.getTheme());
				return typeof rendered === "string" ? rendered.split("\n") : ["Factory renderer returned a non-string value."];
			},
		};
	}
	if (pattern === "render-theme-anim") {
		return {
			render() {
				const rendered = exportValue(context.getTheme(), context.getAnimationState(), options);
				return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
			},
		};
	}
	return {
		render() {
			const rendered = exportValue(context.getAnimationState(), context.getTheme(), options);
			return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
		},
	};
}

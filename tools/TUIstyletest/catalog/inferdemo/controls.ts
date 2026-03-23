import type { StyleTestControl, StyleTestControlValues } from "../../../../src/style-test-contract.js";
import type { InferredField } from "./types.js";

export function buildControls(fields: InferredField[], extraControls: StyleTestControl[], values: StyleTestControlValues): StyleTestControl[] {
	const fieldControls = fields.map((field) => {
		if (field.control.type === "number") {
			return { ...field.control, defaultValue: Number(values[field.id] ?? field.control.defaultValue) };
		}
		if (field.control.type === "boolean") {
			return { ...field.control, defaultValue: Boolean(values[field.id] ?? field.control.defaultValue) };
		}
		return { ...field.control, defaultValue: String(values[field.id] ?? field.control.defaultValue) };
	});
	return [...fieldControls, ...extraControls];
}

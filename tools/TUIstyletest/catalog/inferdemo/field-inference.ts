import ts from "typescript";
import type { StyleTestControlValue } from "../../../../src/style-test-contract.js";
import type { InferredField } from "./types.js";
import { isStringLiteralTypeNode } from "./ast.js";

export function humanizeIdentifier(identifier: string): string {
	return identifier
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/^render\s+/i, "")
		.replace(/^create\s+/i, "")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inferNumericDefault(name: string): number {
	const lowerName = name.toLowerCase();
	if (/huerangestartstep/.test(lowerName)) return 135;
	if (/huerangeendstep/.test(lowerName)) return 156;
	if (/glyphcount/.test(lowerName)) return 128;
	if (/stereostartoffsetstep/.test(lowerName)) return 64;
	if (/hueshiftspeed/.test(lowerName)) return 1;
	if (/huestep/.test(lowerName)) return 128;
	if (/saturation/.test(lowerName)) return 1;
	if (/lightness/.test(lowerName)) return 0.5;
	if (/smoothing/.test(lowerName)) return 0.3;
	if (/(cols|width)/.test(lowerName)) return 24;
	if (/(rows|height)/.test(lowerName)) return 8;
	if (/(count|lines|points|octaves|maxcount|numvlines)/.test(lowerName)) return 8;
	if (/(length|interval|ticks|threshold|generations|beamwidth|strokewidth|rowheight|gap)/.test(lowerName)) return 4;
	if (/direction/.test(lowerName)) return 0;
	if (/phaseoffset/.test(lowerName)) return 0;
	if (/(speed|timescale|decay|damping|density|freq|scale|persistence|inertia|strength|radius|chance|variety|modulation)/.test(lowerName)) return 0.5;
	return 1;
}

export function inferNumberBounds(name: string, defaultValue: number): { min: number; max: number; step: number } {
	const lowerName = name.toLowerCase();
	if (/(huerangestartstep|huerangeendstep|stereostartoffsetstep|glyphcount|huestep)/.test(lowerName)) {
		return { min: 0, max: 256, step: 1 };
	}
	if (/hueshiftspeed/.test(lowerName)) {
		return { min: 0, max: 8, step: 0.05 };
	}
	if (/(saturation|lightness)/.test(lowerName)) {
		return { min: 0, max: 1, step: 0.01 };
	}
	if (/smoothing/.test(lowerName)) {
		return { min: 0, max: 1, step: 0.01 };
	}
	if (/direction/.test(lowerName)) {
		return { min: -1, max: 1, step: 1 };
	}
	if (/phaseoffset/.test(lowerName)) {
		return { min: 0, max: 6.2832, step: 0.1 };
	}
	if (/(cols|width)/.test(lowerName)) {
		return { min: 1, max: 120, step: 1 };
	}
	if (/(rows|height)/.test(lowerName)) {
		return { min: 1, max: 40, step: 1 };
	}
	if (/(count|lines|points|octaves|maxcount|numvlines|interval|ticks|threshold|generations|beamwidth|strokewidth|rowheight|gap)/.test(lowerName)) {
		return { min: 1, max: Math.max(12, defaultValue * 4), step: 1 };
	}
	if (/(speed|timescale|decay|damping|density|freq|scale|persistence|inertia|chance|variety|modulation)/.test(lowerName)) {
		return { min: 0, max: 2, step: 0.01 };
	}
	if (/(strength|radius)/.test(lowerName)) {
		return { min: 0, max: Math.max(10, defaultValue * 4), step: 0.01 };
	}
	if (Number.isInteger(defaultValue)) {
		return { min: 0, max: Math.max(10, defaultValue * 4), step: 1 };
	}
	return { min: 0, max: Math.max(2, defaultValue * 4), step: 0.01 };
}

export function inferComplexDefault(typeNode: ts.TypeNode): unknown {
	if (ts.isArrayTypeNode(typeNode)) {
		return [];
	}
	if (ts.isTypeLiteralNode(typeNode)) {
		return {};
	}
	if (ts.isTypeReferenceNode(typeNode)) {
		if (typeNode.typeName.getText() === "Array") {
			return [];
		}
		return {};
	}
	if (ts.isUnionTypeNode(typeNode)) {
		const stringLiterals = typeNode.types.filter(isStringLiteralTypeNode).map((entry) => entry.literal.text);
		if (stringLiterals.length > 0) {
			return stringLiterals[0] ?? "";
		}
		if (typeNode.types.some((entry) => entry.kind === ts.SyntaxKind.NumberKeyword)) {
			return 0;
		}
	}
	return "";
}

export function formatComplexValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value ?? "", null, 2);
}

export function parseComplexValue(typeNode: ts.TypeNode, rawValue: StyleTestControlValue): unknown {
	const text = String(rawValue).trim();
	if (ts.isUnionTypeNode(typeNode)) {
		const stringLiterals = typeNode.types.filter(isStringLiteralTypeNode).map((entry) => entry.literal.text);
		if (stringLiterals.includes(text)) {
			return text;
		}
		if (typeNode.types.some((entry) => entry.kind === ts.SyntaxKind.NumberKeyword)) {
			const numeric = Number(text);
			if (Number.isFinite(numeric)) {
				return numeric;
			}
		}
	}
	if (text.length === 0) {
		return inferComplexDefault(typeNode);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

export function createField(id: string, typeNode: ts.TypeNode, optional: boolean): InferredField {
	const rawType = typeNode.getText();
	const label = humanizeIdentifier(id);
	if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
		const defaultValue = inferNumericDefault(id);
		const bounds = inferNumberBounds(id, defaultValue);
		return {
			id,
			label,
			rawType,
			kind: "number",
			optional,
			defaultValue,
			control: { id, label, type: "number", defaultValue, min: bounds.min, max: bounds.max, step: bounds.step },
			parse(value) {
				const numeric = typeof value === "number" ? value : Number(value);
				return Number.isFinite(numeric) ? numeric : defaultValue;
			},
			format(value) {
				return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
			},
		};
	}
	if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
		return {
			id,
			label,
			rawType,
			kind: "boolean",
			optional,
			defaultValue: false,
			control: { id, label, type: "boolean", defaultValue: false },
			parse(value) {
				return Boolean(value);
			},
			format(value) {
				return Boolean(value);
			},
		};
	}
	if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
		return {
			id,
			label,
			rawType,
			kind: "string",
			optional,
			defaultValue: "",
			control: { id, label, type: "text", defaultValue: "" },
			parse(value) {
				const next = String(value);
				return optional && next.trim().length === 0 ? undefined : next;
			},
			format(value) {
				return typeof value === "string" ? value : "";
			},
		};
	}
	if (isStringLiteralTypeNode(typeNode)) {
		return {
			id,
			label,
			rawType,
			kind: "enum",
			optional,
			enumOptions: [typeNode.literal.text],
			defaultValue: typeNode.literal.text,
			control: { id, label, type: "enum", defaultValue: typeNode.literal.text, options: [typeNode.literal.text] },
			parse(value) {
				return String(value);
			},
			format(value) {
				return typeof value === "string" ? value : typeNode.literal.text;
			},
		};
	}
	if (ts.isUnionTypeNode(typeNode)) {
		const options = typeNode.types.filter(isStringLiteralTypeNode).map((entry) => entry.literal.text);
		if (options.length === typeNode.types.length) {
			return {
				id,
				label,
				rawType,
				kind: "enum",
				optional,
				enumOptions: options,
				defaultValue: options[0] ?? "",
				control: { id, label, type: "enum", defaultValue: options[0] ?? "", options },
				parse(value) {
					const next = String(value);
					return options.includes(next) ? next : (options[0] ?? "");
				},
				format(value) {
					return typeof value === "string" && options.includes(value) ? value : (options[0] ?? "");
				},
			};
		}
	}
	const defaultValue = inferComplexDefault(typeNode);
	return {
		id,
		label,
		rawType,
		kind: "json",
		optional,
		defaultValue,
		control: {
			id,
			label,
			type: "text",
			defaultValue: formatComplexValue(defaultValue),
			description: `JSON/text value for ${rawType}`,
			multiline: true,
		},
		parse(value) {
			if (optional && String(value).trim().length === 0) {
				return undefined;
			}
			return parseComplexValue(typeNode, value);
		},
		format(value) {
			return formatComplexValue(value === undefined ? defaultValue : value);
		},
	};
}

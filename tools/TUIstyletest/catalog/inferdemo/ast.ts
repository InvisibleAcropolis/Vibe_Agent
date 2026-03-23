import ts from "typescript";
import type { AnimationAdapter, InferredAnimationExport, InferredField, StandardAnimationPattern } from "./types.js";

export function isStringLiteralTypeNode(node: ts.TypeNode): node is ts.LiteralTypeNode & { literal: ts.StringLiteral } {
	return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);
}

export function hasExportModifier(node: ts.Node): boolean {
	return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

export function findOptionsInterfaceName(parameters: readonly ts.ParameterDeclaration[]): string | undefined {
	for (const parameter of parameters) {
		if (!parameter.type || !ts.isTypeReferenceNode(parameter.type)) {
			continue;
		}
		const typeName = parameter.type.typeName.getText();
		if (typeName.endsWith("Options")) {
			return typeName;
		}
	}
	return undefined;
}

export function classifyAnimationExport(
	sourcePath: string,
	fn: ts.FunctionDeclaration,
	interfaceNames: Set<string>,
	adapters: Record<string, AnimationAdapter>,
): { interfaceName: string; pattern: StandardAnimationPattern } | undefined {
	if (!fn.name) {
		return undefined;
	}
	const exportName = fn.name.text;
	const optionsInterfaceName = findOptionsInterfaceName(fn.parameters);
	if (!optionsInterfaceName || !interfaceNames.has(optionsInterfaceName)) {
		return undefined;
	}
	const adapter = adapters[`${sourcePath}#${exportName}`];
	if (adapter?.pattern) {
		return { interfaceName: optionsInterfaceName, pattern: adapter.pattern };
	}
	if (exportName.startsWith("create")) {
		return { interfaceName: optionsInterfaceName, pattern: "factory" };
	}
	const parameterNames = fn.parameters.map((parameter) => parameter.name.getText().toLowerCase());
	if (exportName.startsWith("render") && parameterNames[0]?.includes("anim") && parameterNames[1]?.includes("theme")) {
		return { interfaceName: optionsInterfaceName, pattern: "render-anim-theme" };
	}
	if (exportName.startsWith("render") && parameterNames[0]?.includes("theme") && parameterNames[1]?.includes("anim")) {
		return { interfaceName: optionsInterfaceName, pattern: "render-theme-anim" };
	}
	return undefined;
}

export function collectExportedInterfaces(
	sourceFile: ts.SourceFile,
	createField: (id: string, typeNode: ts.TypeNode, optional: boolean) => InferredField,
): Map<string, InferredField[]> {
	const interfaces = new Map<string, InferredField[]>();
	for (const statement of sourceFile.statements) {
		if (!ts.isInterfaceDeclaration(statement) || !hasExportModifier(statement)) {
			continue;
		}
		if (!statement.name.text.endsWith("Options")) {
			continue;
		}
		const fields: InferredField[] = [];
		for (const member of statement.members) {
			if (!ts.isPropertySignature(member) || !member.type || !member.name || !ts.isIdentifier(member.name)) {
				continue;
			}
			fields.push(createField(member.name.text, member.type, Boolean(member.questionToken)));
		}
		interfaces.set(statement.name.text, fields);
	}
	return interfaces;
}

export function collectAnimationExports(
	sourcePath: string,
	sourceFile: ts.SourceFile,
	interfaces: Map<string, InferredField[]>,
	adapters: Record<string, AnimationAdapter>,
): InferredAnimationExport[] {
	const interfaceNames = new Set<string>(interfaces.keys());
	const exports: InferredAnimationExport[] = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isFunctionDeclaration(statement) || !statement.name || !hasExportModifier(statement)) {
			continue;
		}
		const classified = classifyAnimationExport(sourcePath, statement, interfaceNames, adapters);
		if (!classified) {
			continue;
		}
		exports.push({
			exportName: statement.name.text,
			optionsInterfaceName: classified.interfaceName,
			pattern: classified.pattern,
			fields: interfaces.get(classified.interfaceName) ?? [],
		});
	}
	return exports.sort((a, b) => a.exportName.localeCompare(b.exportName));
}

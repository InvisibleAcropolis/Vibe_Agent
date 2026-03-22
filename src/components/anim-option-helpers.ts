function missingOptionMessage(moduleName: string, optionName: string): string {
	return `${moduleName} requires the '${optionName}' option. Configure it via the style-lab preset or pass it explicitly.`;
}

export function requireNumberOption(value: number | undefined, moduleName: string, optionName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(missingOptionMessage(moduleName, optionName));
	}
	return value;
}

export function requireBooleanOption(value: boolean | undefined, moduleName: string, optionName: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(missingOptionMessage(moduleName, optionName));
	}
	return value;
}

export function requireStringOption<T extends string>(value: T | undefined, moduleName: string, optionName: string): T {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(missingOptionMessage(moduleName, optionName));
	}
	return value;
}

export function requireOption<T>(value: T | undefined, moduleName: string, optionName: string): T {
	if (value === undefined) {
		throw new Error(missingOptionMessage(moduleName, optionName));
	}
	return value;
}

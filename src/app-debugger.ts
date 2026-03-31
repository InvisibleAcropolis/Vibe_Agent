import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { AgentHostState } from "./agent-host.js";

const DEBUG_BUNDLE_ENV = "PI_MONO_APP_DEBUG_BUNDLE";

export interface AppDebuggerSnapshot {
	reason: string;
	tui?: TUI;
	renderedLines?: string[];
	viewport?: { width: number; height: number };
	messages: AgentMessage[];
	hostState?: AgentHostState;
	statusMessage?: string;
	workingMessage?: string;
	helpMessage?: string;
	focusedComponent?: Component | null;
	focusedLabel?: string;
	editorText?: string;
	editorCursor?: { line: number; col: number };
}

export interface PiMonoAppDebugger {
	readonly active: boolean;
	readonly bundleDir?: string;
	log(event: string, details?: Record<string, unknown>): void;
	logError(context: string, error: unknown, details?: Record<string, unknown>): void;
	writeSnapshot(snapshot: AppDebuggerSnapshot): string | undefined;
	describeInput(data: string): Record<string, unknown>;
}

type AppDebuggerOptions = {
	appName: string;
	appRoot: string;
	bundleDir?: string;
};

function sanitizeName(value: string): string {
	return value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function createBundleDir(appRoot: string): string {
	const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	const bundleDir = path.join(appRoot, ".debug", stamp);
	mkdirSync(bundleDir, { recursive: true });
	return bundleDir;
}

function hashText(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function countLines(value: string): number {
	return value.length === 0 ? 1 : value.split(/\r?\n/).length;
}

function getPrintableSummary(data: string): Record<string, unknown> {
	return {
		kind: "printable",
		length: data.length,
		lines: countLines(data),
		hash: hashText(data),
		redacted: true,
	};
}

function getControlSummary(data: string): Record<string, unknown> {
	return {
		kind: "control",
		length: data.length,
		hex: Buffer.from(data, "utf8").toString("hex"),
		escaped: JSON.stringify(data),
	};
}

class FileAppDebugger implements PiMonoAppDebugger {
	readonly active: boolean;
	readonly bundleDir?: string;
	private readonly appName: string;
	private readonly appRoot: string;

	constructor(options: AppDebuggerOptions) {
		this.appName = options.appName;
		this.appRoot = options.appRoot;
		this.bundleDir = options.bundleDir;
		this.active = !!options.bundleDir;

		if (this.bundleDir) {
			mkdirSync(this.bundleDir, { recursive: true });
			const manifestPath = path.join(this.bundleDir, "app-debugger.json");
			if (!existsSync(manifestPath)) {
				writeFileSync(
					manifestPath,
					`${JSON.stringify({ appName: this.appName, appRoot: this.appRoot, bundleDir: this.bundleDir }, null, 2)}\n`,
					"utf8",
				);
			}
		}
	}

	log(event: string, details: Record<string, unknown> = {}): void {
		if (!this.bundleDir) {
			return;
		}
		appendFileSync(
			path.join(this.bundleDir, "app-events.jsonl"),
			`${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}\n`,
			"utf8",
		);
	}

	logError(context: string, error: unknown, details: Record<string, unknown> = {}): void {
		const normalized =
			error instanceof Error
				? { name: error.name, message: error.message, stack: error.stack }
				: { name: "UnknownError", message: String(error), stack: undefined };
		this.log("error", {
			context,
			error: normalized,
			...details,
		});
	}

	writeSnapshot(snapshot: AppDebuggerSnapshot): string | undefined {
		const bundleDir = this.bundleDir ?? createBundleDir(this.appRoot);
		const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
		const safeReason = sanitizeName(snapshot.reason) || "snapshot";
		const snapshotPath = path.join(bundleDir, `${stamp}-${safeReason}.txt`);
		const messagesPath = path.join(bundleDir, `${stamp}-${safeReason}-messages.jsonl`);
		const renderedLines = snapshot.renderedLines ?? snapshot.tui?.render(snapshot.tui.terminal.columns) ?? [];
		const viewport = snapshot.viewport ?? (snapshot.tui ? { width: snapshot.tui.terminal.columns, height: snapshot.tui.terminal.rows } : { width: 0, height: 0 });
		const contents = [
			`Snapshot: ${snapshot.reason}`,
			`Created: ${new Date().toISOString()}`,
			`Terminal: ${viewport.width}x${viewport.height}`,
			`Status: ${snapshot.statusMessage ?? ""}`,
			`Working: ${snapshot.workingMessage ?? ""}`,
			`Help: ${snapshot.helpMessage ?? ""}`,
			`Focused: ${snapshot.focusedLabel ?? snapshot.focusedComponent?.constructor?.name ?? "none"}`,
			`Editor text hash: ${snapshot.editorText ? hashText(snapshot.editorText) : ""}`,
			`Editor text length: ${snapshot.editorText?.length ?? 0}`,
			`Editor lines: ${snapshot.editorText ? countLines(snapshot.editorText) : 0}`,
			`Editor cursor: ${snapshot.editorCursor ? `${snapshot.editorCursor.line}:${snapshot.editorCursor.col}` : "n/a"}`,
			`Host state: ${snapshot.hostState ? JSON.stringify(snapshot.hostState) : "n/a"}`,
			"",
			"=== All rendered lines with visible widths ===",
			...renderedLines.map((line, index) => `[${index}] (w=${visibleWidth(line)}) ${JSON.stringify(line)}`),
			"",
		].join(os.EOL);

		mkdirSync(bundleDir, { recursive: true });
		writeFileSync(snapshotPath, contents, "utf8");
		writeFileSync(messagesPath, `${snapshot.messages.map((message) => JSON.stringify(message)).join(os.EOL)}${os.EOL}`, "utf8");
		this.log("snapshot.write", { reason: snapshot.reason, snapshotPath, messagesPath });
		return bundleDir;
	}

	describeInput(data: string): Record<string, unknown> {
		if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) {
			const pasted = data.slice("\x1b[200~".length, -"\x1b[201~".length);
			return {
				kind: "paste",
				length: pasted.length,
				lines: countLines(pasted),
				hash: hashText(pasted),
				redacted: true,
			};
		}
		const hasControl = /[\x00-\x1f\x7f\x1b]/.test(data);
		return hasControl ? getControlSummary(data) : getPrintableSummary(data);
	}
}

class NoopAppDebugger implements PiMonoAppDebugger {
	readonly active = false;
	readonly bundleDir = undefined;

	log(): void {}

	logError(): void {}

	writeSnapshot(snapshot: AppDebuggerSnapshot): string | undefined {
		const manualDebugger = new FileAppDebugger({
			appName: "vibe-agent",
			appRoot: process.cwd(),
			bundleDir: createBundleDir(process.cwd()),
		});
		return manualDebugger.writeSnapshot(snapshot);
	}

	describeInput(data: string): Record<string, unknown> {
		const manualDebugger = new FileAppDebugger({
			appName: "vibe-agent",
			appRoot: process.cwd(),
			bundleDir: undefined,
		});
		return manualDebugger.describeInput(data);
	}
}

export function createAppDebugger(options: AppDebuggerOptions): PiMonoAppDebugger {
	const bundleDir = options.bundleDir ?? process.env[DEBUG_BUNDLE_ENV];
	if (!bundleDir) {
		return new NoopAppDebugger();
	}
	return new FileAppDebugger({ ...options, bundleDir });
}

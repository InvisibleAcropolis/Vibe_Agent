import test from "node:test";
import assert from "node:assert/strict";
import { TUI } from "@mariozechner/pi-tui";
import { AppMessageSyncService } from "../src/app/app-message-sync-service.js";
import { TranscriptPublicationBridge } from "../src/app/transcript-publication-bridge.js";

class FakeTerminal {
	columns = 120;
	rows = 40;
	setTitle(): void {}
	onKey(_cb: unknown): () => void {
		return () => {};
	}
	onMouse(_cb: unknown): () => void {
		return () => {};
	}
	write(_value: string): void {}
	flush(): void {}
}

function createHarness(options: { publishNormalized?: boolean; mode?: "legacy" | "next" | "dual" } = {}) {
	const messages = [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.UTC(2026, 0, 1) } as any];
	const host = {
		getMessages: () => messages,
		getState: () => ({ isStreaming: false }),
	} as any;
	const setMessagesCalls: number[] = [];
	const publishCalls: unknown[] = [];
	let refreshCount = 0;
	let resetActiveThinkingCount = 0;
	let setArtifactsCount = 0;
	const shellView: any = {
		tui: new TUI(new FakeTerminal() as any, true),
		footerData: { dispose() {} },
		start() {},
		stop() {},
		setEditor() {},
		setFocus() {},
		setMessages(components: unknown[]) {
			setMessagesCalls.push(components.length);
		},
		clearMessages() {},
		setWidget() {},
		setHeaderFactory() {},
		setFooterFactory() {},
		setTitle() {},
		refresh() {
			refreshCount += 1;
		},
		toggleSessionsPanel() {},
		scrollTranscript() {},
		scrollTranscriptToTop() {},
		scrollTranscriptToBottom() {},
		dispatchMouse() { return false; },
		getMenuAnchor() { return { row: 1, col: 1 }; },
	};
	if (options.publishNormalized) {
		shellView.publishNormalizedTranscript = (payload: unknown) => {
			publishCalls.push(payload);
		};
	}
	const stateStore = {
		getState: () => ({ toolOutputExpanded: false }),
		setArtifacts: () => {
			setArtifactsCount += 1;
		},
		resetActiveThinking: () => {
			resetActiveThinkingCount += 1;
		},
	} as any;
	const artifactCatalog = {
		replaceFromMessages: () => {},
	} as any;
	const inventory = {
		listArtifactViews: () => [],
	} as any;
	const service = new AppMessageSyncService(
		host,
		shellView,
		stateStore,
		artifactCatalog,
		inventory,
		() => ({ runtimeId: "coding" }),
		new TranscriptPublicationBridge(options.mode ?? "legacy"),
	);

	return {
		service,
		shellView,
		publishCalls,
		setMessagesCalls,
		getRefreshCount: () => refreshCount,
		getResetCount: () => resetActiveThinkingCount,
		getSetArtifactsCount: () => setArtifactsCount,
	};
}

test("AppMessageSyncService keeps legacy publication semantics in dual mode", () => {
		const harness = createHarness({ publishNormalized: true, mode: "dual" });

	harness.service.sync();

	assert.equal(harness.setMessagesCalls.length, 1);
	assert.equal(harness.publishCalls.length, 1);
	assert.equal(harness.getRefreshCount(), 1);
	assert.equal(harness.getSetArtifactsCount(), 1);
	assert.equal(harness.getResetCount(), 0);
});

test("AppMessageSyncService falls back to legacy rendering when next mode adapter has not migrated", () => {
		const harness = createHarness({ publishNormalized: false, mode: "next" });

	harness.service.sync();

	assert.equal(harness.setMessagesCalls.length, 1);
	assert.equal(harness.publishCalls.length, 0);
	assert.equal(harness.getRefreshCount(), 1);
});

test("AppMessageSyncService resets active thinking when transcript is empty and runtime is idle", () => {
		const harness = createHarness({ publishNormalized: true, mode: "legacy" });

	harness.service.sync({ messages: [], hostState: { isStreaming: false } as any });

	assert.equal(harness.getResetCount(), 1);
});

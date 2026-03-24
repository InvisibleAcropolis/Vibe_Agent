import type { OrcBusEvent } from "../orc-events/types.js";
import { createEventLogTailEntry } from "./view-state.js";
import type { OrcTuiEventLogTailEntry } from "./types.js";

export interface OrcTuiEventBufferOptions {
	maxEventLogEntries: number;
	batchWindowMs: number;
	onFlush(nextTail: OrcTuiEventLogTailEntry[]): void;
}

export interface OrcTuiEventBuffer {
	handleEvent(event: OrcBusEvent): boolean;
	flushNow(currentTail: OrcTuiEventLogTailEntry[]): OrcTuiEventLogTailEntry[];
	reset(): void;
	dispose(): void;
}

export function createOrcTuiEventBuffer(options: OrcTuiEventBufferOptions): OrcTuiEventBuffer {
	let pendingTail: OrcTuiEventLogTailEntry[] = [];
	let seenEventIds = new Set<string>();
	let flushTimer: NodeJS.Timeout | undefined;

	const emit = () => {
		flushTimer = undefined;
		options.onFlush(pendingTail);
		pendingTail = [];
	};

	const scheduleFlush = () => {
		if (flushTimer) {
			return;
		}
		flushTimer = setTimeout(emit, options.batchWindowMs);
	};

	const reset = () => {
		pendingTail = [];
		seenEventIds = new Set();
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
	};

	return {
		handleEvent(event) {
			if (seenEventIds.has(event.envelope.origin.eventId)) {
				return false;
			}
			seenEventIds.add(event.envelope.origin.eventId);
			pendingTail = [
				createEventLogTailEntry(event),
				...pendingTail,
			].slice(0, options.maxEventLogEntries);
			scheduleFlush();
			return true;
		},
		flushNow(currentTail) {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			if (pendingTail.length === 0) {
				return [...currentTail];
			}
			const mergedTail = [...pendingTail, ...currentTail].slice(0, options.maxEventLogEntries);
			pendingTail = [];
			return mergedTail;
		},
		reset,
		dispose() {
			reset();
		},
	};
}

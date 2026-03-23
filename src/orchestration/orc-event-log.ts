import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getVibeLogsDir, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcEventBus, OrcEventBusSubscription } from "./orc-event-bus.js";
import type { OrcBusEvent } from "./orc-events/index.js";

export interface OrcEventLogLocation {
	rootDirPath: string;
	threadDirPath: string;
	runDirPath: string;
	segmentDirPath: string;
	threadId: string;
	runCorrelationId: string;
}

export interface OrcEventLogSegmentDescriptor {
	segmentIndex: number;
	segmentId: string;
	fileName: string;
	filePath: string;
}

export interface OrcEventLogSequenceMetadata {
	streamSequence: number;
	publishSequence?: number;
	deliveredSequence?: number;
	segmentIndex: number;
	segmentEventIndex: number;
	globalEventIndex: number;
}

export interface OrcDurableEventLogRecord {
	version: 1;
	timestamp: string;
	correlation: {
		threadId?: string;
		runCorrelationId: string;
	};
	eventId: string;
	sequence: OrcEventLogSequenceMetadata;
	eventType: OrcBusEvent["kind"];
	event: OrcBusEvent;
}

export interface OrcEventLogReplayHint {
	format: "jsonl";
	ordering: "segment_index_then_line_order";
	notes: string[];
}

export interface OrcEventLogManifest {
	version: 1;
	threadId: string;
	runCorrelationId: string;
	createdAt: string;
	updatedAt: string;
	format: "jsonl";
	failurePolicy: "best_effort_non_fatal";
	rotation: {
		strategy: "max_events_per_segment";
		maxEventsPerSegment: number;
	};
	recovery: {
		partialSegmentPolicy: "ignore_truncated_tail_line";
		replayStartOrder: "sort_by_segment_index_then_line_order";
	};
	replay: OrcEventLogReplayHint;
	segments: Array<{
		segmentIndex: number;
		fileName: string;
		eventCount: number;
		firstEventId?: string;
		lastEventId?: string;
		openedAt: string;
		closedAt?: string;
	}>;
	failures: Array<{
		at: string;
		eventId: string;
		message: string;
	}>;
}

export interface OrcEventLogWriterOptions extends VibeDurablePathOptions {
	threadId: string;
	runCorrelationId: string;
	maxEventsPerSegment?: number;
}

export interface OrcEventLogWriterSnapshot {
	location: OrcEventLogLocation;
	manifestPath: string;
	activeSegment: OrcEventLogSegmentDescriptor;
	writtenEvents: number;
	failedWrites: number;
	lastFailure?: { at: string; eventId: string; message: string };
}

const DEFAULT_MAX_EVENTS_PER_SEGMENT = 1_000;
const EVENT_LOG_FORMAT_NOTES = [
	"Each line is a standalone JSON object containing durable envelope metadata plus the fully normalized OrcBusEvent payload.",
	"Replay tooling should enumerate segment files in ascending numeric order and then feed each parsed line back into bus.publish() or an equivalent reducer input in file order.",
	"If the newest segment ends with a truncated line after a crash, readers should ignore that final partial line and continue with the prior complete records.",
] satisfies string[];

export function sanitizeOrcEventLogPathToken(value: string | undefined, fallback: string): string {
	const sanitized = value?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized && sanitized.length > 0 ? sanitized : fallback;
}

export function getOrcEventLogLocation(
	input: Pick<OrcEventLogWriterOptions, "threadId" | "runCorrelationId">,
	options?: VibeDurablePathOptions,
): OrcEventLogLocation {
	const rootDirPath = join(getVibeLogsDir(options), "orchestration", "event-log");
	const threadId = sanitizeOrcEventLogPathToken(input.threadId, "unknown-thread");
	const runCorrelationId = sanitizeOrcEventLogPathToken(input.runCorrelationId, "unknown-run");
	const threadDirPath = join(rootDirPath, "threads", threadId);
	const runDirPath = join(threadDirPath, "runs", runCorrelationId);
	return {
		rootDirPath,
		threadDirPath,
		runDirPath,
		segmentDirPath: join(runDirPath, "segments"),
		threadId,
		runCorrelationId,
	};
}

export function getOrcEventLogSegmentDescriptor(location: OrcEventLogLocation, segmentIndex: number): OrcEventLogSegmentDescriptor {
	const normalizedIndex = Math.max(1, Math.trunc(segmentIndex));
	const suffix = String(normalizedIndex).padStart(6, "0");
	const fileName = `segment-${suffix}.jsonl`;
	return {
		segmentIndex: normalizedIndex,
		segmentId: `segment-${suffix}`,
		fileName,
		filePath: join(location.segmentDirPath, fileName),
	};
}

export class OrcDurableEventLogWriter {
	private readonly location: OrcEventLogLocation;
	private readonly maxEventsPerSegment: number;
	private readonly manifestPath: string;
	private manifest: OrcEventLogManifest;
	private activeSegment: OrcEventLogSegmentDescriptor;
	private activeSegmentEventCount = 0;
	private globalEventIndex = 0;
	private failedWrites = 0;
	private lastFailure?: { at: string; eventId: string; message: string };

	constructor(options: OrcEventLogWriterOptions) {
		this.location = getOrcEventLogLocation(options, options);
		this.maxEventsPerSegment = Math.max(1, Math.trunc(options.maxEventsPerSegment ?? DEFAULT_MAX_EVENTS_PER_SEGMENT));
		this.manifestPath = join(this.location.runDirPath, "manifest.json");
		this.ensureDirs();
		this.manifest = this.loadOrCreateManifest();
		this.activeSegment = this.initializeActiveSegment();
	}

	write(event: OrcBusEvent, metadata?: { publishSequence?: number; deliveredSequence?: number }): void {
		try {
			this.rotateSegmentIfNeeded();
			const timestamp = event.envelope.when ?? event.envelope.origin.emittedAt ?? new Date().toISOString();
			const segmentEntry = this.manifest.segments.find((entry) => entry.segmentIndex === this.activeSegment.segmentIndex);
			const segmentEventIndex = (segmentEntry?.eventCount ?? 0) + 1;
			const record: OrcDurableEventLogRecord = {
				version: 1,
				timestamp,
				correlation: {
					threadId: event.envelope.origin.threadId,
					runCorrelationId: event.envelope.origin.runCorrelationId,
				},
				eventId: event.envelope.origin.eventId,
				sequence: {
					streamSequence: event.envelope.origin.streamSequence,
					publishSequence: metadata?.publishSequence,
					deliveredSequence: metadata?.deliveredSequence,
					segmentIndex: this.activeSegment.segmentIndex,
					segmentEventIndex,
					globalEventIndex: this.globalEventIndex + 1,
				},
				eventType: event.kind,
				event,
			};
			appendFileSync(this.activeSegment.filePath, `${JSON.stringify(record)}\n`, "utf8");
			this.globalEventIndex += 1;
			this.activeSegmentEventCount += 1;
			if (segmentEntry) {
				segmentEntry.eventCount = segmentEventIndex;
				segmentEntry.lastEventId = event.envelope.origin.eventId;
				segmentEntry.closedAt = timestamp;
				segmentEntry.firstEventId ??= event.envelope.origin.eventId;
			}
			this.manifest.updatedAt = timestamp;
			this.persistManifest();
		} catch (error) {
			const failure = {
				at: new Date().toISOString(),
				eventId: event.envelope.origin.eventId,
				message: error instanceof Error ? error.message : String(error),
			};
			this.failedWrites += 1;
			this.lastFailure = failure;
			this.manifest.failures.push(failure);
			this.manifest.updatedAt = failure.at;
			try {
				this.persistManifest();
			} catch {
				// Event-log persistence is best effort only; runtime supervision must not fail closed on storage issues.
			}
		}
	}

	getSnapshot(): OrcEventLogWriterSnapshot {
		return {
			location: this.location,
			manifestPath: this.manifestPath,
			activeSegment: this.activeSegment,
			writtenEvents: this.globalEventIndex,
			failedWrites: this.failedWrites,
			lastFailure: this.lastFailure,
		};
	}

	private ensureDirs(): void {
		for (const dirPath of [this.location.rootDirPath, this.location.threadDirPath, this.location.runDirPath, this.location.segmentDirPath]) {
			if (!existsSync(dirPath)) {
				mkdirSync(dirPath, { recursive: true, mode: 0o700 });
			}
		}
	}

	private loadOrCreateManifest(): OrcEventLogManifest {
		if (existsSync(this.manifestPath)) {
			return JSON.parse(readFileSync(this.manifestPath, "utf8")) as OrcEventLogManifest;
		}
		const createdAt = new Date().toISOString();
		const manifest: OrcEventLogManifest = {
			version: 1,
			threadId: this.location.threadId,
			runCorrelationId: this.location.runCorrelationId,
			createdAt,
			updatedAt: createdAt,
			format: "jsonl",
			failurePolicy: "best_effort_non_fatal",
			rotation: {
				strategy: "max_events_per_segment",
				maxEventsPerSegment: this.maxEventsPerSegment,
			},
			recovery: {
				partialSegmentPolicy: "ignore_truncated_tail_line",
				replayStartOrder: "sort_by_segment_index_then_line_order",
			},
			replay: {
				format: "jsonl",
				ordering: "segment_index_then_line_order",
				notes: [...EVENT_LOG_FORMAT_NOTES],
			},
			segments: [],
			failures: [],
		};
		this.writeManifest(manifest);
		return manifest;
	}

	private initializeActiveSegment(): OrcEventLogSegmentDescriptor {
		const lastSegment = this.manifest.segments[this.manifest.segments.length - 1];
		this.globalEventIndex = this.manifest.segments.reduce((sum, entry) => sum + entry.eventCount, 0);
		if (lastSegment && lastSegment.eventCount < this.maxEventsPerSegment) {
			this.activeSegmentEventCount = lastSegment.eventCount;
			return getOrcEventLogSegmentDescriptor(this.location, lastSegment.segmentIndex);
		}
		const nextIndex = (lastSegment?.segmentIndex ?? 0) + 1;
		const segment = getOrcEventLogSegmentDescriptor(this.location, nextIndex);
		this.manifest.segments.push({
			segmentIndex: segment.segmentIndex,
			fileName: segment.fileName,
			eventCount: 0,
			openedAt: new Date().toISOString(),
		});
		this.persistManifest();
		this.activeSegmentEventCount = 0;
		return segment;
	}

	private rotateSegmentIfNeeded(): void {
		if (this.activeSegmentEventCount < this.maxEventsPerSegment) {
			return;
		}
		const previousSegment = this.manifest.segments.find((entry) => entry.segmentIndex === this.activeSegment.segmentIndex);
		if (previousSegment && !previousSegment.closedAt) {
			previousSegment.closedAt = new Date().toISOString();
		}
		const nextSegment = getOrcEventLogSegmentDescriptor(this.location, this.activeSegment.segmentIndex + 1);
		this.manifest.segments.push({
			segmentIndex: nextSegment.segmentIndex,
			fileName: nextSegment.fileName,
			eventCount: 0,
			openedAt: new Date().toISOString(),
		});
		this.manifest.updatedAt = new Date().toISOString();
		this.persistManifest();
		this.activeSegment = nextSegment;
		this.activeSegmentEventCount = 0;
	}

	private persistManifest(): void {
		this.writeManifest(this.manifest);
	}

	private writeManifest(manifest: OrcEventLogManifest): void {
		writeFileSync(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	}
}

/**
 * Subscribes durable storage to the live event bus without introducing a fatal dependency in the
 * hot path. Replay tooling can later scan the manifest + ordered JSONL segments and republish each
 * parsed record's `event` field into a fresh bus instance to reconstruct reducer state.
 */
export function attachOrcDurableEventLogWriter(
	bus: OrcEventBus,
	options: OrcEventLogWriterOptions,
): { writer: OrcDurableEventLogWriter; subscription: OrcEventBusSubscription } {
	const writer = new OrcDurableEventLogWriter(options);
	const subscription = bus.subscribe(
		async (event, context) => {
			writer.write(event, {
				publishSequence: context.publishSequence,
				deliveredSequence: context.deliveredSequence,
			});
		},
		{
			label: "durable-event-log-writer",
			handlerKind: "storage",
			filter: {
				runCorrelationId: options.runCorrelationId,
				threadId: options.threadId,
			},
		},
	);
	return { writer, subscription };
}

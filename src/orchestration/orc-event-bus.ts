import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { OrcBusEvent, OrcBusEventKind } from "./orc-events.js";
import type { OrcCanonicalEventEnvelope } from "./orc-io.js";

/**
 * Phase 2 Global Event Bus rules:
 * - The runtime owns bus creation and should create exactly one bus per active orchestration run.
 * - `reset()` starts a fresh in-memory run boundary, clears queued fan-out work, and does not replay prior events.
 * - Replay/history are intentionally out of scope for this module; persistence belongs to storage work in P2-008.
 * - `dispose()` is terminal and must be called by the owning runtime when the run is fully torn down.
 * - Transport, TUI, and storage layers interact only through this typed API and never through `EventEmitter` directly.
 */
export type OrcEventBusOverflowStrategy = "drop_oldest";
export type OrcEventBusLifecycleState = "active" | "disposed";

export interface OrcEventBusLifecycleOwner {
	component: string;
	description?: string;
}

export interface OrcEventBusFilter {
	runCorrelationId?: string;
	threadId?: string;
	kinds?: OrcBusEventKind[];
	predicate?: (event: OrcBusEvent) => boolean;
}

export interface OrcEventBusSubscriberContext {
	subscriberId: string;
	label: string;
	handlerKind: string;
	publishSequence: number;
	deliveredSequence: number;
	matchedRunCorrelationId?: string;
	matchedThreadId?: string;
	queueDepth: number;
	pendingDrops: number;
	overflowWarnings: number;
}

export interface OrcEventBusPublishReceipt {
	publishSequence: number;
	matchedSubscribers: number;
	droppedDeliveries: number;
	eventId: string;
	runCorrelationId?: string;
}

export interface OrcEventBusSnapshot {
	owner?: OrcEventBusLifecycleOwner;
	state: OrcEventBusLifecycleState;
	activeRunCorrelationId?: string;
	publishSequence: number;
	publishedEvents: number;
	activeSubscribers: number;
	totalDroppedDeliveries: number;
	totalOverflowWarnings: number;
	resetCount: number;
	subscribers: OrcEventBusSubscriberSnapshot[];
}

export interface OrcEventBusSubscriberSnapshot {
	subscriberId: string;
	label: string;
	handlerKind: string;
	queueDepth: number;
	maxQueueSize: number;
	overflowStrategy: OrcEventBusOverflowStrategy;
	deliveredCount: number;
	droppedCount: number;
	overflowWarnings: number;
	lastDeliveredAt?: string;
	filter: {
		runCorrelationId?: string;
		threadId?: string;
		kinds?: OrcBusEventKind[];
	};
}

export interface OrcEventBusSubscribeOptions {
	label: string;
	handlerKind?: string;
	filter?: OrcEventBusFilter;
	maxQueueSize?: number;
	overflowStrategy?: OrcEventBusOverflowStrategy;
}

export interface OrcEventBusReplayPolicy {
	available: false;
	reason: "ephemeral_bus" | "post_reset" | "subscriber_attached_late";
}

export interface OrcEventBusResetOptions {
	nextRunCorrelationId?: string;
	reason: string;
}

export interface OrcEventBusSubscription {
	readonly id: string;
	unsubscribe(): boolean;
	getSnapshot(): OrcEventBusSubscriberSnapshot;
}

export interface OrcEventBus {
	subscribe(handler: OrcEventBusSubscriber, options: OrcEventBusSubscribeOptions): OrcEventBusSubscription;
	unsubscribe(subscriptionId: string): boolean;
	publish(event: OrcBusEvent): OrcEventBusPublishReceipt;
	reset(options: OrcEventBusResetOptions): void;
	dispose(): void;
	getSnapshot(): OrcEventBusSnapshot;
	getReplayPolicy(): OrcEventBusReplayPolicy;
}

export type OrcEventBusSubscriber = (event: OrcBusEvent, context: OrcEventBusSubscriberContext) => void | Promise<void>;

interface Deliverable {
	type: "event" | "overflow_warning";
	event: OrcBusEvent;
	publishSequence: number;
}

interface SubscriberRecord {
	id: string;
	listener: (deliverable: Deliverable) => void;
	label: string;
	handlerKind: string;
	handler: OrcEventBusSubscriber;
	filter?: OrcEventBusFilter;
	maxQueueSize: number;
	overflowStrategy: OrcEventBusOverflowStrategy;
	queue: Deliverable[];
	draining: boolean;
	deliveredCount: number;
	deliveredSequence: number;
	droppedCount: number;
	overflowWarnings: number;
	pendingDrops: number;
	lastDeliveredAt?: string;
}

const DEFAULT_MAX_QUEUE_SIZE = 250;
const EVENT_CHANNEL = "event";

export class OrcAsyncEventBus implements OrcEventBus {
	private readonly emitter = new EventEmitter();
	private readonly subscribers = new Map<string, SubscriberRecord>();
	private publishSequence = 0;
	private publishedEvents = 0;
	private totalDroppedDeliveries = 0;
	private totalOverflowWarnings = 0;
	private resetCount = 0;
	private state: OrcEventBusLifecycleState = "active";
	private activeRunCorrelationId?: string;

	constructor(private readonly owner?: OrcEventBusLifecycleOwner) {
		this.emitter.setMaxListeners(0);
	}

	subscribe(handler: OrcEventBusSubscriber, options: OrcEventBusSubscribeOptions): OrcEventBusSubscription {
		this.assertActive();
		const subscriberId = `orc-subscriber-${randomUUID()}`;
		const listener = (deliverable: Deliverable) => {
			if (!matchesFilter(options.filter, deliverable.event)) {
				return;
			}
			this.enqueueDeliverable(this.subscribers.get(subscriberId), deliverable);
		};
		const subscriber: SubscriberRecord = {
			id: subscriberId,
			listener,
			label: options.label,
			handlerKind: options.handlerKind ?? "anonymous",
			handler,
			filter: options.filter,
			maxQueueSize: Math.max(1, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE),
			overflowStrategy: options.overflowStrategy ?? "drop_oldest",
			queue: [],
			draining: false,
			deliveredCount: 0,
			deliveredSequence: 0,
			droppedCount: 0,
			overflowWarnings: 0,
			pendingDrops: 0,
		};

		this.subscribers.set(subscriber.id, subscriber);
		this.emitter.on(EVENT_CHANNEL, subscriber.listener);

		return {
			id: subscriber.id,
			unsubscribe: () => this.unsubscribe(subscriber.id),
			getSnapshot: () => this.buildSubscriberSnapshot(subscriber),
		};
	}

	unsubscribe(subscriptionId: string): boolean {
		const subscriber = this.subscribers.get(subscriptionId);
		if (!subscriber) {
			return false;
		}
		this.subscribers.delete(subscriptionId);
		this.emitter.off(EVENT_CHANNEL, subscriber.listener);
		subscriber.queue.length = 0;
		return true;
	}

	publish(event: OrcBusEvent): OrcEventBusPublishReceipt {
		this.assertActive();
		this.publishedEvents += 1;
		this.publishSequence += 1;
		const publishSequence = this.publishSequence;
		const runCorrelationId = event.envelope.origin.runCorrelationId;
		if (runCorrelationId) {
			if (!this.activeRunCorrelationId) {
				this.activeRunCorrelationId = runCorrelationId;
			} else if (this.activeRunCorrelationId !== runCorrelationId) {
				throw new Error(
					`OrcAsyncEventBus is bound to run ${this.activeRunCorrelationId}; reset before publishing run ${runCorrelationId}.`,
				);
			}
		}

		const deliverable: Deliverable = { type: "event", event, publishSequence };
		const matchedSubscribers = [...this.subscribers.values()].filter((subscriber) => matchesFilter(subscriber.filter, event)).length;
		const droppedBefore = this.totalDroppedDeliveries;
		this.emitter.emit(EVENT_CHANNEL, deliverable);
		const droppedDeliveries = this.totalDroppedDeliveries - droppedBefore;
		return {
			publishSequence,
			matchedSubscribers,
			droppedDeliveries,
			eventId: event.envelope.origin.eventId,
			runCorrelationId,
		};
	}

	reset(options: OrcEventBusResetOptions): void {
		this.assertActive();
		void options.reason;
		for (const subscriber of this.subscribers.values()) {
			subscriber.queue.length = 0;
			subscriber.pendingDrops = 0;
			subscriber.draining = false;
		}
		this.publishSequence = 0;
		this.publishedEvents = 0;
		this.totalDroppedDeliveries = 0;
		this.totalOverflowWarnings = 0;
		this.resetCount += 1;
		this.activeRunCorrelationId = options.nextRunCorrelationId;
	}

	dispose(): void {
		if (this.state === "disposed") {
			return;
		}
		for (const subscriber of this.subscribers.values()) {
			subscriber.queue.length = 0;
			this.emitter.off(EVENT_CHANNEL, subscriber.listener);
		}
		this.subscribers.clear();
		this.emitter.removeAllListeners();
		this.state = "disposed";
	}

	getSnapshot(): OrcEventBusSnapshot {
		return {
			owner: this.owner,
			state: this.state,
			activeRunCorrelationId: this.activeRunCorrelationId,
			publishSequence: this.publishSequence,
			publishedEvents: this.publishedEvents,
			activeSubscribers: this.subscribers.size,
			totalDroppedDeliveries: this.totalDroppedDeliveries,
			totalOverflowWarnings: this.totalOverflowWarnings,
			resetCount: this.resetCount,
			subscribers: [...this.subscribers.values()].map((subscriber) => this.buildSubscriberSnapshot(subscriber)),
		};
	}

	getReplayPolicy(): OrcEventBusReplayPolicy {
		if (this.resetCount > 0 && this.publishSequence === 0) {
			return { available: false, reason: "post_reset" };
		}
		return {
			available: false,
			reason: this.publishSequence === 0 ? "ephemeral_bus" : "subscriber_attached_late",
		};
	}

	private assertActive(): void {
		if (this.state === "disposed") {
			throw new Error("OrcAsyncEventBus has already been disposed.");
		}
	}

	private enqueueDeliverable(subscriber: SubscriberRecord | undefined, deliverable: Deliverable): number {
		if (!subscriber) {
			return 0;
		}
		let dropped = 0;
		if (subscriber.queue.length >= subscriber.maxQueueSize) {
			dropped = this.applyOverflowStrategy(subscriber);
		}
		subscriber.queue.push(deliverable);
		if (!subscriber.draining) {
			subscriber.draining = true;
			queueMicrotask(() => {
				void this.drainSubscriber(subscriber.id);
			});
		}
		return dropped;
	}

	private applyOverflowStrategy(subscriber: SubscriberRecord): number {
		if (subscriber.overflowStrategy !== "drop_oldest") {
			return 0;
		}
		const droppedEntry = subscriber.queue.shift();
		if (!droppedEntry) {
			return 0;
		}
		subscriber.droppedCount += 1;
		if (droppedEntry.type === "event") {
			subscriber.pendingDrops += 1;
			this.totalDroppedDeliveries += 1;
			return 1;
		}
		return 0;
	}

	private async drainSubscriber(subscriberId: string): Promise<void> {
		const subscriber = this.subscribers.get(subscriberId);
		if (!subscriber) {
			return;
		}
		while (subscriber.queue.length > 0 || subscriber.pendingDrops > 0) {
			const deliverable = this.takeNextDeliverable(subscriber);
			if (!deliverable) {
				break;
			}
			await subscriber.handler(deliverable.event, {
				subscriberId: subscriber.id,
				label: subscriber.label,
				handlerKind: subscriber.handlerKind,
				publishSequence: deliverable.publishSequence,
				deliveredSequence: subscriber.deliveredSequence + 1,
				matchedRunCorrelationId: deliverable.event.envelope.origin.runCorrelationId,
				matchedThreadId: deliverable.event.envelope.origin.threadId,
				queueDepth: subscriber.queue.length,
				pendingDrops: subscriber.pendingDrops,
				overflowWarnings: subscriber.overflowWarnings,
			});
			subscriber.deliveredCount += 1;
			subscriber.deliveredSequence += 1;
			subscriber.lastDeliveredAt = new Date().toISOString();
		}
		subscriber.draining = false;
		if (subscriber.queue.length > 0 || subscriber.pendingDrops > 0) {
			subscriber.draining = true;
			queueMicrotask(() => {
				void this.drainSubscriber(subscriber.id);
			});
		}
	}

	private takeNextDeliverable(subscriber: SubscriberRecord): Deliverable | undefined {
		if (subscriber.pendingDrops > 0) {
			subscriber.overflowWarnings += 1;
			this.totalOverflowWarnings += 1;
			const dropped = subscriber.pendingDrops;
			subscriber.pendingDrops = 0;
			return {
				type: "overflow_warning",
				publishSequence: this.publishSequence,
				event: createOverflowWarningEvent(subscriber, dropped, this.activeRunCorrelationId),
			};
		}
		return subscriber.queue.shift();
	}

	private buildSubscriberSnapshot(subscriber: SubscriberRecord): OrcEventBusSubscriberSnapshot {
		return {
			subscriberId: subscriber.id,
			label: subscriber.label,
			handlerKind: subscriber.handlerKind,
			queueDepth: subscriber.queue.length,
			maxQueueSize: subscriber.maxQueueSize,
			overflowStrategy: subscriber.overflowStrategy,
			deliveredCount: subscriber.deliveredCount,
			droppedCount: subscriber.droppedCount,
			overflowWarnings: subscriber.overflowWarnings,
			lastDeliveredAt: subscriber.lastDeliveredAt,
			filter: {
				runCorrelationId: subscriber.filter?.runCorrelationId,
				threadId: subscriber.filter?.threadId,
				kinds: subscriber.filter?.kinds ? [...subscriber.filter.kinds] : undefined,
			},
		};
	}
}

export function createOrcEventBus(owner?: OrcEventBusLifecycleOwner): OrcEventBus {
	return new OrcAsyncEventBus(owner);
}

function matchesFilter(filter: OrcEventBusFilter | undefined, event: OrcBusEvent): boolean {
	if (!filter) {
		return true;
	}
	if (filter.runCorrelationId && filter.runCorrelationId !== event.envelope.origin.runCorrelationId) {
		return false;
	}
	if (filter.threadId && filter.threadId !== event.envelope.origin.threadId) {
		return false;
	}
	if (filter.kinds && !filter.kinds.includes(event.kind)) {
		return false;
	}
	return filter.predicate ? filter.predicate(event) : true;
}

function createOverflowWarningEvent(
	subscriber: Pick<SubscriberRecord, "id" | "label" | "handlerKind">,
	droppedCount: number,
	runCorrelationId?: string,
): OrcBusEvent {
	const emittedAt = new Date().toISOString();
	const envelope: OrcCanonicalEventEnvelope<{ droppedCount: number; subscriberId: string; subscriberLabel: string; handlerKind: string }> = {
		origin: {
			runCorrelationId: runCorrelationId ?? `orc-run-${randomUUID()}`,
			eventId: `orc-event-bus-overflow-${randomUUID()}`,
			streamSequence: 0,
			emittedAt,
			source: "orc_runtime",
		},
		who: {
			kind: "system",
			id: "orc-event-bus",
			label: "Orc Event Bus",
		},
		what: {
			category: "diagnostic",
			name: "event_bus_overflow",
			description: `Subscriber ${subscriber.label} dropped ${droppedCount} queued events due to backpressure.`,
			severity: "warning",
			status: "failed",
		},
		how: {
			channel: "event_bus",
			interactionTarget: "computer",
			environment: "transport",
			transport: "in_process",
		},
		when: emittedAt,
		rawPayload: {
			namespace: "orc.event_bus.overflow",
			payload: {
				droppedCount,
				subscriberId: subscriber.id,
				subscriberLabel: subscriber.label,
				handlerKind: subscriber.handlerKind,
			},
		},
	};
	return {
		kind: "stream.warning",
		envelope,
		payload: {
			warningCode: "event_bus_subscriber_overflow",
			message: `Subscriber ${subscriber.label} dropped ${droppedCount} queued events due to backpressure.`,
			stream: "event_bus",
			recoverable: true,
		},
		interaction: {
			target: "computer",
			lane: "system_support",
			isUserFacing: false,
			isComputerFacing: true,
		},
		debug: {
			normalizedFrom: "event_bus:event_bus_overflow",
			notes: ["Generated by OrcAsyncEventBus because a subscriber exceeded its queue budget."],
			rawPayload: envelope.rawPayload,
		},
	};
}

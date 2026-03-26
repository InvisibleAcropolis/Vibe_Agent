import { StringDecoder } from "node:string_decoder";

export interface StreamParserQuarantinedFrame {
	rawFrame: string;
	reason: "json_parse_error" | "validation_failed" | "frame_overflow";
	detail: string;
	receivedAt: string;
	byteLength: number;
}

export interface StreamParserOptions<TValue> {
	maxBufferBytes?: number;
	maxQuarantineFrames?: number;
	validate?: (value: unknown) => value is TValue;
}

export interface StreamParserDrainResult<TValue> {
	parsed: TValue[];
	quarantined: StreamParserQuarantinedFrame[];
	bufferedBytes: number;
}

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUARANTINE_FRAMES = 128;

/**
 * Strict LF-framed JSON stream parser used for process stdout telemetry.
 *
 * Contract:
 * - consumes arbitrary UTF-8 chunk boundaries from stdout,
 * - appends chunk data to an internal string buffer,
 * - only splits on LF (`\n`),
 * - only attempts JSON parse on complete LF-terminated frames.
 */
export class JsonLfStreamParser<TValue> {
	private readonly decoder = new StringDecoder("utf8");
	private readonly maxBufferBytes: number;
	private readonly maxQuarantineFrames: number;
	private readonly validate?: (value: unknown) => value is TValue;
	private buffer = "";
	private quarantined: StreamParserQuarantinedFrame[] = [];

	constructor(options: StreamParserOptions<TValue> = {}) {
		this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
		this.maxQuarantineFrames = options.maxQuarantineFrames ?? DEFAULT_MAX_QUARANTINE_FRAMES;
		this.validate = options.validate;
	}

	pushChunk(chunk: Buffer | string): StreamParserDrainResult<TValue> {
		const textChunk = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		if (textChunk.length > 0) {
			this.buffer += textChunk;
		}
		const parsed = this.drainCompleteFrames();
		this.guardBufferBudget();
		return this.consumeResult(parsed);
	}

	finish(): StreamParserDrainResult<TValue> {
		const trailing = this.decoder.end();
		if (trailing.length > 0) {
			this.buffer += trailing;
		}
		const parsed = this.drainCompleteFrames();
		if (this.buffer.length > 0) {
			this.quarantine(this.buffer, "frame_overflow", "stream ended with an unterminated LF-delimited frame");
			this.buffer = "";
		}
		return this.consumeResult(parsed);
	}

	private drainCompleteFrames(): TValue[] {
		const parsed: TValue[] = [];
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const frame = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			this.parseFrame(frame, parsed);
			newlineIndex = this.buffer.indexOf("\n");
		}
		return parsed;
	}

	private parseFrame(frame: string, parsed: TValue[]): void {
		const normalized = frame.endsWith("\r") ? frame.slice(0, -1) : frame;
		if (normalized.trim().length === 0) {
			return;
		}
		let candidate: unknown;
		try {
			candidate = JSON.parse(normalized);
		} catch (error) {
			this.quarantine(normalized, "json_parse_error", error instanceof Error ? error.message : String(error));
			return;
		}
		if (this.validate && !this.validate(candidate)) {
			this.quarantine(normalized, "validation_failed", "frame failed parser-level validation");
			return;
		}
		parsed.push(candidate as TValue);
	}

	private guardBufferBudget(): void {
		const bufferedBytes = Buffer.byteLength(this.buffer, "utf8");
		if (bufferedBytes <= this.maxBufferBytes) {
			return;
		}
		const overflowFrame = this.buffer;
		this.buffer = "";
		this.quarantine(overflowFrame, "frame_overflow", `buffer exceeded ${this.maxBufferBytes} bytes before an LF boundary`);
	}

	private quarantine(rawFrame: string, reason: StreamParserQuarantinedFrame["reason"], detail: string): void {
		this.quarantined.push({
			rawFrame,
			reason,
			detail,
			receivedAt: new Date().toISOString(),
			byteLength: Buffer.byteLength(rawFrame, "utf8"),
		});
		if (this.quarantined.length > this.maxQuarantineFrames) {
			this.quarantined = this.quarantined.slice(this.quarantined.length - this.maxQuarantineFrames);
		}
	}

	private consumeResult(parsed: TValue[]): StreamParserDrainResult<TValue> {
		const quarantined = this.quarantined;
		this.quarantined = [];
		return {
			parsed,
			quarantined,
			bufferedBytes: Buffer.byteLength(this.buffer, "utf8"),
		};
	}
}

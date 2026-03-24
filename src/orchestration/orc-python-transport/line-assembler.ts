import { Buffer } from "node:buffer";
import type { AssembledLine, LineAssemblyState, TransportStream } from "./types.js";

export function drainTerminatedLines(state: LineAssemblyState): AssembledLine[] {
	const lines: AssembledLine[] = [];
	let newlineIndex = state.buffer.indexOf("\n");
	while (newlineIndex >= 0) {
		const text = state.buffer.slice(0, newlineIndex);
		const byteLength = Buffer.byteLength(text, "utf8");
		state.buffer = state.buffer.slice(newlineIndex + 1);
		state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
		lines.push({ text, terminated: true, byteLength });
		newlineIndex = state.buffer.indexOf("\n");
	}
	return lines;
}

export function flushResidualStream(params: {
	stream: TransportStream;
	state: LineAssemblyState;
	emitDecoderRemainder: boolean;
	setBufferedBytes: (stream: TransportStream, value: number) => void;
	onStdoutLine: (line: AssembledLine) => void;
	onStderrLine: (line: string) => void;
	onPartialStdoutLine: (line: string) => void;
}): void {
	const { emitDecoderRemainder, onPartialStdoutLine, onStderrLine, onStdoutLine, setBufferedBytes, state, stream } = params;
	if (emitDecoderRemainder) {
		state.buffer += state.decoder.end();
	} else {
		state.decoder.end();
	}
	state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
	setBufferedBytes(stream, state.bufferedBytes);
	for (const line of drainTerminatedLines(state)) {
		if (stream === "stdout") {
			onStdoutLine(line);
			continue;
		}
		onStderrLine(line.text);
	}
	if (state.buffer.length === 0) {
		return;
	}
	const leftover = state.buffer;
	state.buffer = "";
	state.bufferedBytes = 0;
	setBufferedBytes(stream, 0);
	if (stream === "stdout") {
		onPartialStdoutLine(leftover);
		return;
	}
	onStderrLine(leftover);
}

export function guardBuffer(params: {
	stream: TransportStream;
	state: LineAssemblyState;
	maxBufferedBytes: number;
	setBufferedBytes: (stream: TransportStream, value: number) => void;
	onStderrOverflow: (bufferedBytes: number) => void;
	onStdoutOverflow: (buffer: string, bufferedBytes: number) => void;
}): boolean {
	const { maxBufferedBytes, onStderrOverflow, onStdoutOverflow, setBufferedBytes, state, stream } = params;
	if (state.bufferedBytes <= maxBufferedBytes) {
		return true;
	}
	if (stream === "stderr") {
		state.buffer = state.buffer.slice(-Math.floor(maxBufferedBytes / 2));
		state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
		setBufferedBytes(stream, state.bufferedBytes);
		onStderrOverflow(state.bufferedBytes);
		return true;
	}
	onStdoutOverflow(state.buffer, state.bufferedBytes);
	return false;
}

export function setBufferedBytes(stream: TransportStream, value: number, update: { stdout: (value: number) => void; stderr: (value: number) => void }): void {
	if (stream === "stdout") {
		update.stdout(value);
		return;
	}
	update.stderr(value);
}

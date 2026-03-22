import { join } from "node:path";
import { getAgentDir } from "../local-coding-agent.js";

function encodeWorkspacePath(cwd: string): string {
	return Buffer.from(cwd).toString("base64url");
}

export function getRuntimeSessionDir(runtimeId: string, cwd = process.cwd()): string {
	return join(getAgentDir(), "sessions", runtimeId, encodeWorkspacePath(cwd));
}

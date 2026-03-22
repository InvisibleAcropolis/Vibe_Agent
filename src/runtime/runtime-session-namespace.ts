import { join } from "node:path";
import { getVibeSessionsDir } from "../durable/durable-paths.js";

function encodeWorkspacePath(cwd: string): string {
	return Buffer.from(cwd).toString("base64url");
}

export function getRuntimeSessionDir(runtimeId: string, cwd = process.cwd(), durableRoot?: string): string {
	return join(getVibeSessionsDir({ durableRoot }), runtimeId, encodeWorkspacePath(cwd));
}

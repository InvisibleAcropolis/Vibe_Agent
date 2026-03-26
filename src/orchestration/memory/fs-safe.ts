import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LOCK_FILE_NAME = ".orc-memory.lock";

export function ensureDirSync(path: string): void {
	mkdirSync(path, { recursive: true });
}

export function withDirectoryLockSync<T>(dirPath: string, callback: () => T): T {
	ensureDirSync(dirPath);
	const lockPath = join(dirPath, LOCK_FILE_NAME);
	const lockFd = openSync(lockPath, "wx");
	try {
		return callback();
	} finally {
		closeSync(lockFd);
		unlinkSync(lockPath);
	}
}

export function atomicWriteJsonSync(path: string, value: unknown): void {
	ensureDirSync(dirname(path));
	const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tempPath, path);
}

export function readJsonIfExistsSync<T>(path: string): T | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw) as T;
}

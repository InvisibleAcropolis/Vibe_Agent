import { existsSync, type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findGitHeadPath(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = content.slice(8);
						const headPath = resolve(dir, gitDir, "HEAD");
						if (existsSync(headPath)) return headPath;
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (existsSync(headPath)) return headPath;
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export class FooterDataProvider {
	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null | undefined = undefined;
	private gitWatcher: FSWatcher | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;

	constructor(private readonly cwd: string) {
		this.setupGitWatcher();
	}

	getGitBranch(): string | null {
		if (this.cachedBranch !== undefined) return this.cachedBranch;

		try {
			const gitHeadPath = findGitHeadPath(this.cwd);
			if (!gitHeadPath) {
				this.cachedBranch = null;
				return null;
			}
			const content = readFileSync(gitHeadPath, "utf8").trim();
			this.cachedBranch = content.startsWith("ref: refs/heads/") ? content.slice(16) : "detached";
		} catch {
			this.cachedBranch = null;
		}
		return this.cachedBranch;
	}

	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
			return;
		}
		this.extensionStatuses.set(key, text);
	}

	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	dispose(): void {
		this.gitWatcher?.close();
		this.gitWatcher = null;
		this.branchChangeCallbacks.clear();
	}

	private setupGitWatcher(): void {
		const gitHeadPath = findGitHeadPath(this.cwd);
		if (!gitHeadPath) return;

		try {
			this.gitWatcher = watch(dirname(gitHeadPath), (_eventType, filename) => {
				if (filename === "HEAD") {
					this.cachedBranch = undefined;
					for (const callback of this.branchChangeCallbacks) {
						callback();
					}
				}
			});
			this.gitWatcher.unref?.();
		} catch {
			// Ignore missing watch support.
		}
	}
}

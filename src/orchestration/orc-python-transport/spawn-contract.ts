import type { OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "../orc-io.js";

/**
 * Builds the default Python runner spawn contract so process invocation changes
 * remain isolated from transport supervision, parsing, and health accounting.
 */
export function defaultBuildPythonRunnerSpawnContract(input: OrcRunnerLaunchInput): OrcPythonRunnerSpawnContract {
	const isWindows = process.platform === "win32";
	return {
		command: isWindows ? "py" : "python3",
		args: [...(isWindows ? ["-3.11"] : []), "-m", "src.orchestration.python.orc_runner"],
		cwd: process.cwd(),
		stdinPayload: input,
		stdoutProtocol: "jsonl",
		stderrProtocol: "diagnostic_text",
	};
}

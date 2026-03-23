import type { OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "../orc-io.js";

/**
 * Builds the default Python runner spawn contract so process invocation changes
 * remain isolated from transport supervision, parsing, and health accounting.
 */
export function defaultBuildPythonRunnerSpawnContract(input: OrcRunnerLaunchInput): OrcPythonRunnerSpawnContract {
	return {
		command: "python3",
		args: ["-m", "src.orchestration.python.orc_runner"],
		cwd: input.workspaceRoot,
		stdinPayload: input,
		stdoutProtocol: "jsonl",
		stderrProtocol: "diagnostic_text",
	};
}

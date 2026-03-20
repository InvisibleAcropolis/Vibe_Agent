#!/usr/bin/env node

/**
 * FutureIDE Agent - Professional Agentic CLI Application
 *
 * This application deprecates the WebUI of the coding-agent package and
 * provides a complete terminal-based experience using the TUI shell shape
 * from future-ide-tui. All interactions with the AI agent happen through
 * this unified TUI interface.
 *
 * Features:
 * - Full chat interface with streaming responses
 * - Tool execution display (read, write, edit, bash, grep, find, ls)
 * - Artifact viewer for files and code created by the agent
 * - Session management (new, resume, fork, tree navigation)
 * - Model and thinking level selection
 * - Extension support with custom UI
 * - Session statistics and token usage tracking
 * - HTML export
 * - Debug snapshot system
 * - Mouse support
 * - Theming
 */

import { createAppDebugger } from "./app-debugger.js";
import { createDefaultAgentHost } from "./debug-agent-host.js";
import { FutureIdeAgentApp } from "./app.js";

const debuggerSink = createAppDebugger({
	appName: "future-ide-agent",
	appRoot: process.cwd(),
});
const app = new FutureIdeAgentApp({
	debugger: debuggerSink,
	host: createDefaultAgentHost(debuggerSink),
});

const stopApp = () => {
	app.stop();
};

process.on("SIGINT", stopApp);
process.on("SIGTERM", stopApp);
process.on("uncaughtException", (error) => {
	debuggerSink.logError("process.uncaughtException", error);
	app.writeDebugSnapshot("uncaught-exception");
});
process.on("unhandledRejection", (error) => {
	debuggerSink.logError("process.unhandledRejection", error);
	app.writeDebugSnapshot("unhandled-rejection");
});
process.on("warning", (warning) => {
	debuggerSink.log("process.warning", {
		name: warning.name,
		message: warning.message,
		stack: warning.stack,
	});
});

app.start();

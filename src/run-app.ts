import { createAppDebugger } from "./app-debugger.js";
import { createDefaultAgentHost } from "./debug-agent-host.js";
import { VibeAgentApp } from "./app.js";

export function startVibeAgentApp(): VibeAgentApp {
	const debuggerSink = createAppDebugger({
		appName: "vibe-agent",
		appRoot: process.cwd(),
	});
	const app = new VibeAgentApp({
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
	return app;
}

import { createAppDebugger } from "./app-debugger.js";
import { createDefaultAgentHost } from "./debug-agent-host.js";
import { readPsmuxRuntimeContext } from "./psmux-runtime-context.js";
import { startSplashPaneApp, type SplashPaneAppHandle } from "./splash-pane-app.js";
import { VibeAgentApp } from "./app.js";

type RuntimeHandle = Pick<VibeAgentApp, "stop" | "writeDebugSnapshot"> | SplashPaneAppHandle;

export function startVibeAgentApp(): RuntimeHandle {
	const debuggerSink = createAppDebugger({
		appName: "vibe-agent",
		appRoot: process.cwd(),
	});
	const runtimeContext = readPsmuxRuntimeContext();
	const app =
		runtimeContext.role === "secondary"
			? startSplashPaneApp({
				debugger: debuggerSink,
				sessionName: runtimeContext.sessionName,
			})
			: new VibeAgentApp({
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

	if (app instanceof VibeAgentApp) {
		app.start();
	}
	return app;
}

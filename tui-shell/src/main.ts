import { MasterTuiApp } from "./master-tui-app.js";

const app = new MasterTuiApp();

const stopApp = () => {
	app.stop();
};

process.on("SIGINT", stopApp);
process.on("SIGTERM", stopApp);

app.start();

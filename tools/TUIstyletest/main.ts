#!/usr/bin/env node

import { TUIStyleTestApp } from "./app.js";

const app = new TUIStyleTestApp();

const stopApp = () => {
	app.stop();
};

process.on("SIGINT", stopApp);
process.on("SIGTERM", stopApp);

app.start();

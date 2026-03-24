import type { ThemeConfig } from "./index.js";

export const defaultTheme: ThemeConfig = {
	name: "default",
	hueRange: [190, 220],
	hueSaturation: 0.75,
	hueLightness: 0.55,
	breathBaseColor: "#254560",
	breathPeakColor: "#60d2ff",
	ornateFrame: {
		shade1: "#0d2035",
		shade2: "#254560",
		shade3: "#3a7ab0",
		shade4: "#60d2ff",
	},
};

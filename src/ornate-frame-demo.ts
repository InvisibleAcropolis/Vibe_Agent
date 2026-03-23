// Quick visual smoke test — run with: npx tsx src/ornate-frame-demo.ts
import { loadAllTileSets } from "./ornate-frame-tiles/index.js";
import { OrnateFrame } from "./components/ornate-frame.js";

const VARIANTS = ["baroque", "gothic", "art-nouveau", "celtic", "art-deco", "egyptian"] as const;
const WIDTH = 80;
const CONTENT = [
  "  Hello from the OrnateFrame renderer  ",
  "  Testing 9-patch tiling at width 80   ",
  "                                       ",
];

await loadAllTileSets();

for (const variant of VARIANTS) {
  console.log(`\n${"─".repeat(WIDTH)}`);
  console.log(`Variant: ${variant}`);
  console.log("─".repeat(WIDTH));
  const frame = new OrnateFrame({ variant });
  const lines = frame.render(CONTENT, WIDTH);
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
}

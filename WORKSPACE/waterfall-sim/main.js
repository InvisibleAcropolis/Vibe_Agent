import { createWorld } from "./src/world.js";
import { createPhysics } from "./src/physics.js";
import { render } from "./src/render.js";
import { setupUI } from "./src/ui.js";

const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvas();
window.addEventListener("resize", () => {
  resizeCanvas();
  world = createWorld(canvas.clientWidth, canvas.clientHeight);
});

let world = createWorld(canvas.clientWidth, canvas.clientHeight);
const physics = createPhysics({ maxParticles: 11000 });

const ui = setupUI({
  flowRate: 900,
  gravity: 1400,
  spread: 40,
  restitution: 0.2,
  friction: 0.06,
  poolDamping: 4,
});

ui.onReset(() => physics.reset());

let accumulator = 0;
let lastTime = performance.now();
const fixedDt = 1 / 120;

let fpsSmoothed = 60;

function frame(now) {
  const dtReal = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dtReal;

  const fpsNow = 1 / Math.max(1e-6, dtReal);
  fpsSmoothed = fpsSmoothed * 0.9 + fpsNow * 0.1;

  if (!ui.isPaused()) {
    while (accumulator >= fixedDt) {
      physics.step(world, fixedDt, ui.params);
      accumulator -= fixedDt;
    }
  }

  render(ctx, world, physics.particles);
  ui.setStats({ particleCount: physics.particles.length, fps: fpsSmoothed });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

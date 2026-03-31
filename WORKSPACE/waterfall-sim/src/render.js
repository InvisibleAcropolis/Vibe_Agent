function drawTerrain(ctx, world) {
  ctx.strokeStyle = "#435d6f";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  for (const s of world.terrainSegments) {
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }
}

function drawPoolTint(ctx, world) {
  const p = world.poolRegion;
  const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
  g.addColorStop(0, "rgba(65, 128, 170, 0.14)");
  g.addColorStop(1, "rgba(27, 77, 110, 0.34)");
  ctx.fillStyle = g;
  ctx.fillRect(p.x, p.y, p.width, p.height);
}

export function render(ctx, world, particles) {
  ctx.clearRect(0, 0, world.width, world.height);

  drawPoolTint(ctx, world);
  drawTerrain(ctx, world);

  for (const p of particles) {
    const speed = Math.hypot(p.vx, p.vy);
    const alpha = Math.min(0.85, 0.22 + speed / 1400);

    // slight streak for fast particles
    ctx.strokeStyle = `rgba(163, 215, 255, ${alpha * 0.45})`;
    ctx.lineWidth = Math.max(0.7, p.r * 0.65);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.008, p.y - p.vy * 0.008);
    ctx.stroke();

    ctx.fillStyle = `rgba(133, 201, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // emitter marker
  ctx.fillStyle = "rgba(245, 245, 245, 0.55)";
  ctx.beginPath();
  ctx.arc(world.emitter.x, world.emitter.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

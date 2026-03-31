function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function collideSegment(p, segment) {
  const ax = segment.a.x;
  const ay = segment.a.y;
  const bx = segment.b.x;
  const by = segment.b.y;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = p.x - ax;
  const apy = p.y - ay;

  const t = clamp(dot(apx, apy, abx, aby) / (abx * abx + aby * aby), 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;

  const dx = p.x - cx;
  const dy = p.y - cy;
  const distSq = dx * dx + dy * dy;
  const rr = p.r * p.r;

  if (distSq >= rr || distSq === 0) return false;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const penetration = p.r - dist;

  p.x += nx * penetration;
  p.y += ny * penetration;

  return { nx, ny };
}

export function createPhysics(config) {
  const particles = [];
  const maxParticles = config.maxParticles ?? 9000;
  let spawnCarry = 0;

  function reset() {
    particles.length = 0;
    spawnCarry = 0;
  }

  function spawn(world, dt, params) {
    const count = params.flowRate * dt + spawnCarry;
    const whole = Math.floor(count);
    spawnCarry = count - whole;

    for (let i = 0; i < whole && particles.length < maxParticles; i++) {
      const spread = (Math.random() - 0.5) * params.spread;
      const speedJitter = 0.85 + Math.random() * 0.35;

      particles.push({
        x: world.emitter.x + spread,
        y: world.emitter.y + spread * 0.15,
        vx: world.emitter.dirX * world.emitter.speed * speedJitter + (Math.random() - 0.5) * 55,
        vy: world.emitter.dirY * world.emitter.speed * speedJitter + (Math.random() - 0.5) * 30,
        life: 0,
        r: 1.6 + Math.random() * 1.3,
      });
    }
  }

  function integrate(world, dt, params) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;

      p.vy += params.gravity * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // pool damping (M2 behavior)
      const pool = world.poolRegion;
      if (p.y > pool.y) {
        const depth = (p.y - pool.y) / Math.max(pool.height, 1);
        const damp = 1 - Math.min(0.96, params.poolDamping * depth * dt);
        p.vx *= damp;
        p.vy *= damp;
      }

      // collisions against terrain segments
      for (const segment of world.terrainSegments) {
        const hit = collideSegment(p, segment);
        if (!hit) continue;

        const vn = dot(p.vx, p.vy, hit.nx, hit.ny);
        if (vn < 0) {
          p.vx -= (1 + params.restitution) * vn * hit.nx;
          p.vy -= (1 + params.restitution) * vn * hit.ny;

          // tangential friction
          const tx = -hit.ny;
          const ty = hit.nx;
          const vt = dot(p.vx, p.vy, tx, ty);
          p.vx -= vt * params.friction * tx;
          p.vy -= vt * params.friction * ty;
        }
      }

      // cull old/out of range particles
      if (
        p.x < -40 || p.x > world.width + 40 ||
        p.y < -40 || p.y > world.height + 120 ||
        p.life > 9
      ) {
        particles.splice(i, 1);
      }
    }
  }

  function step(world, dt, params) {
    spawn(world, dt, params);
    integrate(world, dt, params);
  }

  return {
    particles,
    step,
    reset,
  };
}

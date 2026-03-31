export function setupUI(initialParams) {
  const ids = [
    "flowRate",
    "gravity",
    "spread",
    "restitution",
    "friction",
    "poolDamping",
  ];

  const params = { ...initialParams };

  for (const id of ids) {
    const input = document.getElementById(id);
    const value = document.getElementById(id + "Value");

    input.value = params[id];
    value.textContent = String(params[id]);

    input.addEventListener("input", () => {
      const parsed = Number(input.value);
      params[id] = Number.isFinite(parsed) ? parsed : params[id];
      value.textContent = String(params[id]);
    });
  }

  const pauseBtn = document.getElementById("pauseBtn");
  const resetBtn = document.getElementById("resetBtn");

  let paused = false;
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  });

  return {
    params,
    isPaused: () => paused,
    onReset: (cb) => resetBtn.addEventListener("click", cb),
    setStats: ({ particleCount, fps }) => {
      document.getElementById("particleCount").textContent = String(particleCount);
      document.getElementById("fps").textContent = String(fps.toFixed(0));
    },
  };
}

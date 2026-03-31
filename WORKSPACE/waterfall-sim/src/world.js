export function createWorld(width, height) {
  const poolTop = Math.floor(height * 0.72);

  const terrainSegments = [
    // upper cliff face
    { a: { x: 0, y: height * 0.22 }, b: { x: width * 0.26, y: height * 0.3 } },
    // lip where water exits
    { a: { x: width * 0.26, y: height * 0.3 }, b: { x: width * 0.36, y: height * 0.28 } },
    // near vertical drop wall
    { a: { x: width * 0.36, y: height * 0.28 }, b: { x: width * 0.4, y: height * 0.66 } },
    // splash rock
    { a: { x: width * 0.46, y: height * 0.68 }, b: { x: width * 0.55, y: height * 0.76 } },
    // pool floor
    { a: { x: 0, y: height * 0.9 }, b: { x: width, y: height * 0.9 } },
  ];

  return {
    width,
    height,
    emitter: {
      x: width * 0.315,
      y: height * 0.26,
      dirX: 0.55,
      dirY: 0.08,
      speed: 310,
    },
    poolRegion: {
      x: 0,
      y: poolTop,
      width,
      height: height - poolTop,
    },
    terrainSegments,
  };
}

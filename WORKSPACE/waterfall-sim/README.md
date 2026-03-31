# Waterfall Simulation (HTML + Canvas)

Prototype includes:
- M1: emitter + gravity + fixed timestep simulation
- M2: terrain collisions + pool damping region

## Run
Because this uses ES modules, run via a local server from this folder.

Example using Node:

```bash
npx serve .
```

Then open the printed URL in your browser.

## Files
- `index.html` - UI and canvas
- `styles.css` - layout and styling
- `main.js` - app loop
- `src/world.js` - terrain/emitter setup
- `src/physics.js` - particle physics + collisions
- `src/render.js` - drawing
- `src/ui.js` - controls/stats

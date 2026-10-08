# Farm Hands

A cozy singleplayer 3D farming game set in a pastoral countryside with a starter farmhouse, split-rail fencing, cobblestone path, orchard trees, and wildflowers. The full-window field features nine soil plots in a 3×3 grid. Click or tap to plant; drag to rotate around the field; scroll or pinch to zoom in and out; use WASD to move the camera across the ground. Keyboard users can select plots with the arrow keys and plant with Enter.

Use the Weather menu to switch between warm sunlight, light rain, moderate rain, and heavy rain. Rain changes the sky, light, and number and speed of falling drops. The scene keeps its chosen weather while you plant or rotate. Rain and smoke animations pause when reduced motion is requested.

Click the 3D farmhouse (or the top-left Farmhouse button, or press `C`) to open the Farmhouse Calendar menu, which displays the live calendar, current year progress, upcoming farm events, and farm ledger.

Use the developer Speed Up button (`⚡ 3× Speed`, or press `T` / `]`) to cycle game speeds (3×, 15×, 60×, 300×, 1200×) for testing calendar progression across days, months, and seasons.

To run it locally, start a static server in this folder (for example, `python3 -m http.server 8000`) and visit `http://localhost:8000`. The files also run directly from the root of a GitHub Pages repository.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

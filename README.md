# Farm Hands

A cozy singleplayer 3D farming game set in a pastoral countryside with a starter farmhouse, split-rail fencing, cobblestone path, orchard trees, wildflowers, a pond, pine forest, boulders, and a rolling northern hill. The full-window field features nine soil plots in a 3×3 winter wheat year: the game begins in July with an overgrown field, then you clear weeds, cultivate the seedbed, and drill wheat during September and October. Drag to rotate around the field; scroll or pinch to zoom in and out; use WASD to move the camera across the ground. Keyboard users can select plots with the arrow keys and work the soil with Enter. Plot states, weather, the farm clock, and the camera position are saved in your browser and restored automatically the next time you visit.

Press `Esc` at any time to open the pause menu, which holds three options:

- **Resume Farming** — close the menu and get back to the field. The farm clock pauses while the menu is open, so reading never costs you in-game time.
- **Credits** — who grew this little farm, plus the three.js, OrbitControls, and Google Fonts licences.
- **Settings** — turn camera memory on or off, recenter the camera, and rebind every key in the game. Click a key, press the key you want, and it applies immediately; `Backspace` clears a key, `Esc` cancels, and **Reset keybinds** restores the defaults. A key can only belong to one action, so rebinding it releases it from wherever it was before. `Esc` always opens this menu, even if "Open this menu" is bound to something else.

Camera memory (on by default) stores both the camera position and its orbit target, so panning, rotating, and zooming all come back exactly as you left them.

Use the Weather menu to switch between warm sunlight, light rain, moderate rain, and heavy rain. Rain changes the sky, light, and number and speed of falling drops. The scene keeps its chosen weather while you plant or rotate. Rain and smoke animations pause when reduced motion is requested.

Click the 3D farmhouse (or the top-left Farmhouse button, or press `C`) to open the Farmhouse Calendar menu, which displays the live calendar, a top-down farm map, current year progress, upcoming winter wheat events, and field ledger.

Use the developer Speed Up button (`⚡ 3× Speed`, or press `T` / `]`) to cycle game speeds (3×, 15×, 60×, 300×, 1200×) for testing calendar progression across days, months, and seasons.

To run it locally, start a static server in this folder (for example, `python3 -m http.server 8000`) and visit `http://localhost:8000`. The files also run directly from the root of a GitHub Pages repository.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

# Farm Hands

A small singleplayer 3D farming game set in an open grassland with a starter farmhouse. The full-window field starts with nine small soil plots in a 3×3 grid. Click or tap to plant; drag to rotate around the field; scroll or pinch to zoom in and out; use WASD to move the camera across the ground. Keyboard users can select plots with the arrow keys and plant with Enter.

Use the Weather menu to switch between normal sunlight, light rain, moderate rain, and heavy rain. Rain changes the sky, light, and number and speed of falling drops. The scene keeps its chosen weather while you plant or rotate. Rain animation pauses when reduced motion is requested.

The calendar starts on March 1 of Year 1 at 06:00. Game time advances three seconds per real second, including while the game is closed. Its starting time is saved in this browser so the date continues across reloads.

To run it locally, start a static server in this folder (for example, `python3 -m http.server 8000`) and visit `http://localhost:8000`. The files also run directly from the root of a GitHub Pages repository.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

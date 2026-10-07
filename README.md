# Farm Hands

A small singleplayer 3D farming game set in an open grassland with a starter farmhouse. The full-window field lets you plant wheat in twelve soil plots. Click or tap to plant; drag to rotate around the field; scroll or pinch to zoom in and out. Keyboard users can select plots with the arrow keys and plant with Enter.

Use the Weather menu to switch between normal sunlight, light rain, moderate rain, and heavy rain. Rain changes the sky, light, and number and speed of falling drops. The scene keeps its chosen weather while you plant or rotate. Rain animation pauses when reduced motion is requested.

To run it locally, start a static server in this folder (for example, `python3 -m http.server 8000`) and visit `http://localhost:8000`. The files also run directly from the root of a GitHub Pages repository.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

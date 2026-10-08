# Farm Hands

A small, singleplayer 3D farm about helping Farmer John grow winter wheat. A fresh game opens on July 1 of Year 1 with only a farmhouse, no field, and an empty inventory. John introduces himself, then the player draws a rectangular site for the first nine-plot field from an overhead view. Existing saves keep their field and progress.

## Play

- Click or tap a plot to open its raised action menu above the plot, then choose the available seasonal task. Completed actions are crossed out; future work displays its season. Farmer John walks to the plot during a short work animation, with a floating stopwatch showing the remaining time. In July and August, clear the field, test the soil, and cultivate it. Drill winter wheat from September 1 through October 10. The later stages follow the schedule below.
- Drag to orbit, scroll or pinch to zoom, and use WASD to move the camera. Clicking a plot gently centers the view on it; this can be switched off in Settings. **Back to home** smoothly focuses the farmhouse. Click the farmhouse or press `C` / `H` to open the farmhouse journal.
- The journal has calendar, map, inventory, and shop pages. Click a calendar date to read its field note. The pixel map redraws from the current terrain, field, plot states, and Farmer John's location; drag to pan and scroll or use the controls to zoom. The inventory starts empty and shows owned goods as icon tiles; hover over or focus a tile to see its name. The farm starts with 100 coins; buy supplies and sell harvested goods in the shop. Supplies, coins, field placement, and plot work are saved locally in the browser.
- The top-right signboard combines coins with the in-game clock and date. The hand-painted, timber-framed interface uses Alegreya and Alegreya Sans.
- Use the **Time** control to cycle through 120×, 300×, 1000×, and 10000× game time. At night, the sky and fields darken while the farmhouse illuminates its surroundings. Press `Esc` for settings, credits, and keybindings. The Developer section has a two-step reset that clears saved farm data in this browser. It also has an optional calendar time skip: enable it, open the calendar, choose a future date, and confirm the jump.

## Winter wheat year

| Calendar | Available field work |
| --- | --- |
| July–August | Harvest mature wheat from July 20, then clear, test, and cultivate plots for the next seedbed. The first year starts with clearing. |
| September–October 10 | Drill winter wheat into cultivated plots. Each plot uses one bag of seed. |
| October 11–November | Check planted plots for weeds, slugs, and pests. |
| December–January | Crop dormancy; no plot action. |
| February–March | Apply spring fertiliser to planted plots. |
| April | Stem extension; no plot action. |
| May–June | Treat planted plots as ears emerge, flowers open, and grain begins forming. |
| June–July | Grain fills and ripens; the plants turn golden. |
| July 20–August | Harvest ripe wheat, store grain, bale straw, and retain seed for the next sowing. Clear, test, and cultivate after harvest. |

The plot menu enables only work allowed by the current date and plot state. If supplies are missing, buy them in the shop page. After a harvest, the field can be prepared for the next crop in the rotation; the current playable crop is winter wheat.

## Run locally

From this folder, run `python3 -m http.server 8000` and visit [http://localhost:8000](http://localhost:8000). The files can also be served directly by GitHub Pages. Run `node --test tests/farming.test.mjs` to check the seasonal action gates.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

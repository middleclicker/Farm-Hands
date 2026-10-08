# Farm Hands

A small, singleplayer 3D farm about helping Farmer John grow winter wheat. A fresh game opens on July 1 of Year 1 with a farmhouse, a car, a road to town, no field, and an empty inventory. John introduces himself, then the player draws a rectangular site for a field of fixed-size crop cells from a gridded, elevated view. Existing saves keep their field and progress.

## Play

- The ranch boundary is dotted. While zoning, choose 2–6 crop cells per side. The preview shows rocks, high and low ground, tree-blocked cells, and an estimated cleanup cost. Marking a field leaves dotted cell lines over the grass. A tree may stand inside the field, but its crop cells remain empty until tree-removal equipment becomes available. Click each highlighted stone to have John remove it, then click orange high ground to fetch the shovel and dig. The terrain changes as John digs and fills. Dug soil forms a labeled pile beside the field, can fill blue low ground, and is spread into nearby terrain if any remains after cleanup. If there is too little, shallow areas remain. Worked ground retains its dirt marks after cleanup, while untouched ground keeps its original surface; each plot first changes to exposed soil when John turns under grass, then to a seedbed when he breaks up the soil. Hover over the field or bring John or the camera near it to see cleanliness, flatness, nearby soil, and soil quality. Quality shows `?` until the report is read, then reflects the completed soil plan. Jobs cost coins and energy; walking also uses energy. John recovers when he sleeps, with no passive daytime recovery.
- After cleanup, start the soil study and mark five points on alternating field edges. A colored overlay shows how much of the field the planned W represents; sampling starts only at 100% coverage. John walks the route, scoops each handful, and seals it in a plastic bag. Right click the car to have John walk over and board; use **Leave car** to park and get out. You drive to the science center: hold `W`/`↑` to accelerate, `S`/`↓` to brake or reverse, and `A`/`D` or `←`/`→` to steer. On touchscreens, drag up and sideways on the phone map. The car moves freely and slows off the road; the phone map shows the actual farm road, Charlie's connected lane, and the town hall and science center on their respective sides of the road. Park by the science center, pay 12 coins for the soil test, then drive home; John hands over the sample bag at the lab. The HUD shows the one-game-day lab test progress. Charlie mails the winter wheat field guide while the lab works. The mailbox has its own screen, a HUD alert, and a marker above the mailbox when new mail arrives; the dated pH, phosphorus, potassium, and magnesium report enters Journal → Knowledge only after you open and read it. It shows the game's workable minimum and maximum and a winter wheat optimum for each measurement. After reading the report, Charlie walks over from his cottage and speaks in a bottom-of-screen dialogue scene. Choose plant as-is, targeted correction, or full correction. The HUD lists the required amendments and the shop sells them. Buy what is missing, then start the chosen plan separately; John applies the corrections before plot work begins. A reading outside the workable interval stops field work until the chosen correction makes it workable. These values are simulation rules, not agronomic recommendations.
- Click or tap a plot to open its raised menu above the plot. It shows only the plot's current seasonal action, when one is available. Farmer John walks to the plot during a short work animation, with a floating stopwatch showing the remaining time. Drill winter wheat from September 1 through October 10. The later stages follow the schedule below.
- Drag to orbit, scroll or pinch to zoom, and use WASD to move the camera. Click bare ground to send John walking to that spot; plot and cleanup clicks keep their own actions. Clicking a plot gently centers the view on it; this can be switched off in Settings. **Back to home** smoothly focuses the farmhouse. Click the farmhouse or press `C` / `H` to open the farmhouse journal.
- The fixed-height journal has calendar, map, inventory, shop, and knowledge pages. Click a calendar date to read its field note. The pixel map redraws from the current terrain, field, town, car, plot states, and Farmer John's location; drag to pan and scroll or use the controls to zoom. The inventory starts empty and shows owned goods as icon tiles; hover over or focus a tile to see its name. The farm starts with 100 coins; buy supplies and sell harvested goods in the shop. Supplies, coins, field placement, soil testing, and plot work are saved locally in the browser.
- The top-right signboard combines coins, John's energy, and the in-game clock and date. The hand-painted, timber-framed interface uses Alegreya and Alegreya Sans. Procedural sound effects accompany fieldwork, driving, mail, and menus; they can be switched off in Settings.
- John walks with arm and leg motion, breathes and blinks while idle, and returns to the farmhouse to sleep at about 10 PM. Work after 10 PM drains his energy quickly. At midnight or when his energy runs out, he heads home, sleeps, and resumes an interrupted job at 8 AM. His location is saved across refreshes.
- Use the **Time** control to cycle through 120×, 300×, 1000×, and 10000× game time. At night, the sky and fields darken while the farmhouse illuminates its surroundings. Press `Esc` for settings, credits, and keybindings. The Developer section has a two-step reset that clears saved farm data in this browser. It also has an optional calendar time skip: enable it, open the calendar, choose a future date, and confirm the jump.

## Winter wheat year

| Calendar | Available field work |
| --- | --- |
| July–August | Harvest mature wheat from July 20, then turn under grass and break up soil for the next seedbed. The first year begins with ground cleanup, a science center field soil test, and Charlie's soil plan. |
| September–October 10 | Drill winter wheat into cultivated plots. Each plot uses one bag of seed. |
| October 11–November | Check planted plots for weeds, slugs, and pests. |
| December–January | Crop dormancy; no plot action. |
| February–March | Apply spring fertiliser to planted plots. |
| April | Stem extension; no plot action. |
| May–June | Treat planted plots as ears emerge, flowers open, and grain begins forming. |
| June–July | Grain fills and ripens; the plants turn golden. |
| July 20–August | Harvest ripe wheat, store grain, bale straw, and retain seed for the next sowing. Turn under grass and break up soil after harvest. |

The plot menu offers only the current task allowed by the date and plot state. If supplies are missing, buy them in the shop page. After a harvest, the field can be prepared for the next crop in the rotation; the current playable crop is winter wheat.

## Project statistics

| Measure | Current value |
| --- | ---: |
| Maximum crop cells per field | 36 (6 × 6) |
| Seasonal plot actions | 7 |
| Playable crops | 1 (winter wheat) |
| Farm time speeds | 4 (120×, 300×, 1000×, 10000×) |
| Town sites and homes | 3 (town hall, science center, and Charlie's cottage) |
| Field soil samples | 5, walked in a W pattern |
| Soil report turnaround | 1 game day |
| Seasonal schedule assertions | 22 |

These values describe the game and its checked-in schedule test as of October 2026. Repository activity is available on the [GitHub project page](https://github.com/middleclicker/Farm-Hands).

## Run locally

From this folder, run `python3 -m http.server 8000` and visit [http://localhost:8000](http://localhost:8000). The files can also be served directly by GitHub Pages. Run `node --test tests/*.test.mjs` to check seasonal actions and the sample plan.

The 3D scene uses a local copy of Three.js 0.186.1. Its MIT license is in `vendor/three/LICENSE`.

## Community and project policies

Read the [contributing guide](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), and [accessibility notes](ACCESSIBILITY.md) before participating. Bug and feature issue forms and a pull request template are provided on GitHub. Licensing terms for Farm Hands are in [LICENSE](LICENSE); Three.js keeps its separate MIT license.

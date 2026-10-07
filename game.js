const PLOT_COUNT = 12;
const STORAGE_KEY = 'farm-hands-wheat-plots-v1';

const field = document.querySelector('#field');
const count = document.querySelector('#planted-count');
const status = document.querySelector('#field-status');

function loadPlantedPlots() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return new Set();
    return new Set(saved.filter((plot) => Number.isInteger(plot) && plot >= 1 && plot <= PLOT_COUNT));
  } catch {
    return new Set();
  }
}

const plantedPlots = loadPlantedPlots();

function updateCount() {
  count.textContent = `${plantedPlots.size} / ${PLOT_COUNT}`;
  if (plantedPlots.size === PLOT_COUNT) {
    status.textContent = 'Every plot has wheat planted.';
  }
}

function plantWheat(plot, button) {
  if (plantedPlots.has(plot)) return;
  plantedPlots.add(plot);
  button.classList.add('planted');
  button.disabled = true;
  button.setAttribute('aria-label', `Wheat planted in plot ${plot}`);
  status.textContent = `Wheat planted in plot ${plot}.`;
  updateCount();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...plantedPlots]));
  } catch {
    // Planting still works when browser storage is unavailable.
  }
}

for (let plot = 1; plot <= PLOT_COUNT; plot += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plot';
  button.setAttribute('aria-label', `Plant wheat in plot ${plot}`);
  button.innerHTML = '<span class="sprouts" aria-hidden="true"><span class="sprout"></span><span class="sprout"></span><span class="sprout"></span></span>';
  if (plantedPlots.has(plot)) {
    button.classList.add('planted');
    button.disabled = true;
    button.setAttribute('aria-label', `Wheat planted in plot ${plot}`);
  }
  button.addEventListener('click', () => plantWheat(plot, button));
  field.append(button);
}

updateCount();

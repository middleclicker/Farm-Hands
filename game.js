const PLOT_COUNT = 12;

const field = document.querySelector('#field');
const count = document.querySelector('#planted-count');
const status = document.querySelector('#field-status');
const plantedPlots = new Set();

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
}

for (let plot = 1; plot <= PLOT_COUNT; plot += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plot';
  button.setAttribute('aria-label', `Plant wheat in plot ${plot}`);
  button.innerHTML = '<span class="sprouts" aria-hidden="true"><span class="sprout"></span><span class="sprout"></span><span class="sprout"></span></span>';
  button.addEventListener('click', () => plantWheat(plot, button));
  field.append(button);
}

updateCount();

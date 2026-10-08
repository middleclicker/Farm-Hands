const DEFAULT_SPEED = 3;
const SPEED_LEVELS = [3, 15, 60, 300, 1200];
const GAME_START = Date.UTC(2001, 2, 1, 6); // March 1, Year 1, 06:00:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_TIME_KEY = 'farm-hands-calendar-time-v2';
const STORAGE_LAST_REAL_KEY = 'farm-hands-calendar-lastreal-v2';
const STORAGE_SPEED_KEY = 'farm-hands-calendar-speed-v2';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const seasons = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'];

// Recurring farm events (month is 0-indexed, matching Date#getUTCMonth).
const events = [
  { month: 2, day: 1, emoji: '🌱', title: 'Spring Sowing Day', description: 'Plant the first seeds of the year in freshly thawed soil.' },
  { month: 2, day: 20, emoji: '🌷', title: 'Spring Equinox', description: 'Flower buds open across the pasture as winter fades away.' },
  { month: 5, day: 21, emoji: '☀️', title: 'Midsummer Fair', description: 'The longest day of the year — hay is cut and the village gathers.' },
  { month: 8, day: 22, emoji: '🌾', title: 'Harvest Festival', description: 'Gather the ripe wheat bushels and celebrate the autumn harvest.' },
  { month: 9, day: 31, emoji: '🎃', title: 'Lantern Night', description: 'Carved lanterns glow along the farm lane at dusk.' },
  { month: 11, day: 21, emoji: '❄️', title: 'Winter Solstice', description: 'The shortest day — rest by the hearth and plan for spring.' },
];
const eventByDate = new Map(events.map((event) => [`${event.month}-${event.day}`, event]));
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LOOKAHEAD_DAYS = 30;

let currentSpeedIndex = 0;
let gameSpeed = SPEED_LEVELS[0];
let accumulatedGameMs = 0;
let lastRealTick = Date.now();

// DOM elements
const dateLabel = document.querySelector('#calendar-date');
const seasonLabel = document.querySelector('#calendar-season');
const clockLabel = document.querySelector('#calendar-clock');
const dayLabel = document.querySelector('#calendar-day');
const yearTrack = document.querySelector('#calendar-year-track');
const yearFill = document.querySelector('#calendar-year-fill');
const yearLabel = document.querySelector('#calendar-year-label');
const speedBadge = document.querySelector('#calendar-speed-badge');
const speedBtn = document.querySelector('#speed-btn');
const speedBtnLabel = document.querySelector('#speed-btn-label');
const modalSpeedBtn = document.querySelector('#modal-speed-btn');
const modalSpeedText = document.querySelector('#modal-speed-text');
const hudSeason = document.querySelector('#hud-season');
const hudDateTime = document.querySelector('#hud-date-time');

// Farmhouse modal elements
const farmhouseModal = document.querySelector('#farmhouse-modal');
const modalBackdrop = document.querySelector('#modal-backdrop');
const modalCloseBtn = document.querySelector('#modal-close-btn');
const modalFooterCloseBtn = document.querySelector('#modal-footer-close-btn');
const farmhouseHudBtn = document.querySelector('#farmhouse-btn');

// Events calendar elements
const eventCalendarMonth = document.querySelector('#event-calendar-month');
const eventCalendarGrid = document.querySelector('#event-calendar-grid');
const upcomingEventsList = document.querySelector('#upcoming-events-list');

const pad = (value) => String(value).padStart(2, '0');

function initGameTime() {
  const now = Date.now();
  try {
    const savedTime = Number(localStorage.getItem(STORAGE_TIME_KEY));
    const savedLastReal = Number(localStorage.getItem(STORAGE_LAST_REAL_KEY));
    const savedSpeed = Number(localStorage.getItem(STORAGE_SPEED_KEY));

    if (Number.isFinite(savedSpeed) && SPEED_LEVELS.includes(savedSpeed)) {
      currentSpeedIndex = SPEED_LEVELS.indexOf(savedSpeed);
      gameSpeed = savedSpeed;
    }

    if (Number.isFinite(savedTime) && savedTime >= 0 && Number.isFinite(savedLastReal) && savedLastReal > 0) {
      // Offline time advances at standard 3x baseline up to 14 days maximum
      const offlineRealMs = Math.max(0, now - savedLastReal);
      const offlineGameMs = Math.min(offlineRealMs, 14 * DAY_MS) * DEFAULT_SPEED;
      accumulatedGameMs = savedTime + offlineGameMs;
      lastRealTick = now;
      return;
    }

    // Check legacy storage
    const legacyStart = Number(localStorage.getItem('farm-hands-calendar-start-v1'));
    if (Number.isFinite(legacyStart) && legacyStart > 0) {
      accumulatedGameMs = Math.max(0, now - legacyStart) * DEFAULT_SPEED;
      lastRealTick = now;
      return;
    }
  } catch {
    // If storage is unavailable, start fresh
  }

  accumulatedGameMs = 0;
  lastRealTick = now;
}

function saveGameTime() {
  try {
    localStorage.setItem(STORAGE_TIME_KEY, String(Math.floor(accumulatedGameMs)));
    localStorage.setItem(STORAGE_LAST_REAL_KEY, String(Date.now()));
    localStorage.setItem(STORAGE_SPEED_KEY, String(gameSpeed));
  } catch {}
}

function advanceGameTime() {
  const now = Date.now();
  const delta = now - lastRealTick;
  lastRealTick = now;
  if (delta > 0) {
    accumulatedGameMs += delta * gameSpeed;
  }
}

export function getGameDate() {
  advanceGameTime();
  return new Date(GAME_START + accumulatedGameMs);
}

function updateSpeedUI() {
  const speedStr = `${gameSpeed}×`;
  if (speedBtnLabel) speedBtnLabel.textContent = `${speedStr} Speed`;
  if (speedBadge) speedBadge.textContent = `${speedStr} real time`;
  if (modalSpeedText) modalSpeedText.textContent = speedStr;
  if (speedBtn) {
    speedBtn.setAttribute('aria-label', `Developer speedup: currently ${speedStr}. Click to cycle.`);
    if (gameSpeed > 3) {
      speedBtn.classList.add('active-speedup');
    } else {
      speedBtn.classList.remove('active-speedup');
    }
  }
}

export function setGameSpeed(speed) {
  advanceGameTime();
  if (SPEED_LEVELS.includes(speed)) {
    gameSpeed = speed;
    currentSpeedIndex = SPEED_LEVELS.indexOf(speed);
  } else {
    gameSpeed = speed;
  }
  updateSpeedUI();
  updateCalendar();
  saveGameTime();
}

export function cycleGameSpeed() {
  advanceGameTime();
  currentSpeedIndex = (currentSpeedIndex + 1) % SPEED_LEVELS.length;
  gameSpeed = SPEED_LEVELS[currentSpeedIndex];
  updateSpeedUI();
  updateCalendar();
  saveGameTime();
  return gameSpeed;
}

export function openFarmhouseMenu() {
  if (!farmhouseModal) return;
  farmhouseModal.removeAttribute('hidden');
  farmhouseHudBtn?.setAttribute('aria-expanded', 'true');
  updateCalendar();
  modalCloseBtn?.focus();
  document.dispatchEvent(new CustomEvent('farmhouse-modal-open'));
}

export function closeFarmhouseMenu() {
  if (!farmhouseModal) return;
  farmhouseModal.setAttribute('hidden', '');
  farmhouseHudBtn?.setAttribute('aria-expanded', 'false');
  document.dispatchEvent(new CustomEvent('farmhouse-modal-close'));
  const canvas = document.querySelector('#field');
  canvas?.focus({ preventScroll: true });
}

export function toggleFarmhouseMenu() {
  if (farmhouseModal?.hasAttribute('hidden')) {
    openFarmhouseMenu();
  } else {
    closeFarmhouseMenu();
  }
}

let lastRenderedDayKey = '';

function upcomingEvents(date) {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const end = start + LOOKAHEAD_DAYS * DAY_MS;
  const results = [];
  for (let time = start; time <= end; time += DAY_MS) {
    const day = new Date(time);
    const event = eventByDate.get(`${day.getUTCMonth()}-${day.getUTCDate()}`);
    if (event) {
      results.push({
        ...event,
        year: day.getUTCFullYear(),
        month: day.getUTCMonth(),
        day: day.getUTCDate(),
      });
    }
  }
  return results;
}

function renderEventCalendar(date) {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const today = date.getUTCDate();

  if (eventCalendarMonth) eventCalendarMonth.textContent = `${months[month]} ${year}`;

  if (eventCalendarGrid) {
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = WEEKDAY_LABELS.map((label) => `<span class="event-cal-weekday">${label}</span>`);
    for (let i = 0; i < firstWeekday; i += 1) cells.push('<span class="event-cal-day is-empty"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const event = eventByDate.get(`${month}-${day}`);
      const classes = ['event-cal-day'];
      if (day === today) classes.push('is-today');
      if (event) classes.push('has-event');
      const marker = event ? `<span class="event-cal-dot">${event.emoji}</span>` : '';
      cells.push(`<span class="${classes.join(' ')}">${day}${marker}</span>`);
    }
    // Pad the trailing cells so the last week is complete.
    const totalCells = firstWeekday + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailingBlanks; i += 1) cells.push('<span class="event-cal-day is-empty"></span>');
    eventCalendarGrid.innerHTML = cells.join('');
  }
}

function renderUpcomingEvents(date) {
  if (!upcomingEventsList) return;
  const upcoming = upcomingEvents(date);
  if (upcoming.length === 0) {
    upcomingEventsList.innerHTML = '<li class="upcoming-events-empty">No upcoming events in the next 30 days.</li>';
    return;
  }
  upcomingEventsList.innerHTML = upcoming.map((event) => {
    const isToday = event.month === date.getUTCMonth() && event.day === date.getUTCDate();
    const yearSuffix = event.year !== date.getUTCFullYear() ? `, ${event.year}` : '';
    const todayBadge = isToday ? '<span class="upcoming-today">Today</span>' : '';
    return `<li class="upcoming-event">
      <span class="upcoming-event-emoji" aria-hidden="true">${event.emoji}</span>
      <div class="upcoming-event-body">
        <div class="upcoming-event-title">${event.title}${todayBadge}</div>
        <div class="upcoming-event-desc">${event.description}</div>
      </div>
      <time class="upcoming-event-date">${months[event.month]} ${event.day}${yearSuffix}</time>
    </li>`;
  }).join('');
}

export function updateCalendar() {
  advanceGameTime();
  const date = new Date(GAME_START + accumulatedGameMs);
  const month = date.getUTCMonth();
  const currentSeason = seasons[month];
  const gameYear = date.getUTCFullYear() - 2000;
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const nextYear = Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), month, date.getUTCDate()) - yearStart) / DAY_MS) + 1;
  const daysInYear = (nextYear - yearStart) / DAY_MS;
  const yearProgress = ((date.getTime() - yearStart) / (nextYear - yearStart)) * 100;

  const dateText = `${months[month]} ${date.getUTCDate()}`;
  const seasonText = `${currentSeason} · Year ${gameYear}`;
  const clockText = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const shortClockText = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  const dayText = `Day ${dayOfYear} of ${daysInYear}`;

  if (dateLabel) dateLabel.textContent = dateText;
  if (seasonLabel) seasonLabel.textContent = seasonText;
  if (clockLabel) clockLabel.textContent = clockText;
  if (dayLabel) dayLabel.textContent = dayText;
  if (yearLabel) yearLabel.textContent = `Year ${gameYear}`;
  if (yearFill) yearFill.style.width = `${yearProgress}%`;
  if (yearTrack) {
    yearTrack.setAttribute('aria-valuenow', String(Math.floor(yearProgress)));
    yearTrack.setAttribute('aria-valuetext', `Day ${dayOfYear} of ${daysInYear}, Year ${gameYear}`);
  }

  // Update HUD summary
  if (hudSeason) hudSeason.textContent = seasonText;
  if (hudDateTime) hudDateTime.textContent = `${months[month].slice(0, 3)} ${date.getUTCDate()} · ${shortClockText}`;

  // Re-render the events calendar only when the in-game day changes.
  const dayKey = `${date.getUTCFullYear()}-${month}-${date.getUTCDate()}`;
  if (dayKey !== lastRenderedDayKey) {
    lastRenderedDayKey = dayKey;
    renderEventCalendar(date);
    renderUpcomingEvents(date);
  }
}

// Wire up events
speedBtn?.addEventListener('click', () => cycleGameSpeed());
modalSpeedBtn?.addEventListener('click', () => cycleGameSpeed());
// Delegate the HUD trigger so it remains wired even when the module is loaded
// before the body finishes parsing or is evaluated through the game import.
document.addEventListener('click', (event) => {
  const target = event.target?.closest?.('#farmhouse-btn');
  if (target) {
    toggleFarmhouseMenu();
  }
});
modalCloseBtn?.addEventListener('click', () => closeFarmhouseMenu());
modalFooterCloseBtn?.addEventListener('click', () => closeFarmhouseMenu());
modalBackdrop?.addEventListener('click', () => closeFarmhouseMenu());

window.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) {
    return;
  }

  // Toggle calendar modal with 'c' or 'h'
  if ((event.key === 'c' || event.key === 'C' || event.key === 'h' || event.key === 'H') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    toggleFarmhouseMenu();
    return;
  }

  // Close modal with Escape
  if (event.key === 'Escape' && farmhouseModal && !farmhouseModal.hasAttribute('hidden')) {
    event.preventDefault();
    closeFarmhouseMenu();
    return;
  }

  // Dev speedup hotkeys: 'T' or ']' to cycle/speed up, '[' to slow down
  if ((event.key === 't' || event.key === 'T' || event.key === ']') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    cycleGameSpeed();
    return;
  }
  if (event.key === '[' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    advanceGameTime();
    currentSpeedIndex = (currentSpeedIndex - 1 + SPEED_LEVELS.length) % SPEED_LEVELS.length;
    gameSpeed = SPEED_LEVELS[currentSpeedIndex];
    updateSpeedUI();
    updateCalendar();
    saveGameTime();
  }
});

// Periodic save and cleanup
window.addEventListener('beforeunload', saveGameTime);
setInterval(saveGameTime, 5000);

// Initialize
initGameTime();
updateSpeedUI();
updateCalendar();
setInterval(updateCalendar, 100);

// Expose on window for game.js and dev console
window.FarmCalendar = {
  getSpeed: () => gameSpeed,
  setSpeed: setGameSpeed,
  cycleSpeed: cycleGameSpeed,
  openFarmhouseMenu,
  closeFarmhouseMenu,
  toggleFarmhouseMenu,
  updateCalendar,
};

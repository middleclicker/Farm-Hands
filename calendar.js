import { eventMatches } from './keybinds.js?v=farmer-john-2';
import { farmPhase, phaseMessage } from './farming.mjs?v=farmer-john-2';

const DEFAULT_SPEED = 120;
const SPEED_LEVELS = [120, 300, 1000, 10000];
const GAME_START = Date.UTC(2001, 6, 1, 6); // July 1, Year 1, 06:00:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_TIME_KEY = 'farm-hands-calendar-time-v3';
const STORAGE_LAST_REAL_KEY = 'farm-hands-calendar-lastreal-v3';
const STORAGE_SPEED_KEY = 'farm-hands-calendar-speed-v3';
const STORAGE_DEV_TIME_KEY = 'farm-hands-developer-time-v1';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const seasons = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'];

// Recurring farm events (month is 0-indexed, matching Date#getUTCMonth).
// Follows the winter wheat growing year: July–August field preparation,
// September–October drilling, autumn germination, winter dormancy, spring
// tillering and stem extension, and the summer harvest.
const events = [
  { month: 6, day: 1, emoji: '🚜', title: 'Field Preparation', description: 'Clear empty plots, test the soil, and cultivate a seedbed.' },
  { month: 6, day: 20, emoji: '🌾', title: 'Wheat Harvest', description: 'Harvest ripe wheat and store the grain.' },
  { month: 7, day: 1, emoji: '🚜', title: 'Prepare the Next Seedbed', description: 'Clear harvested plots, test the soil, and cultivate for the next crop.' },
  { month: 8, day: 1, emoji: '🌱', title: 'Drill Winter Wheat', description: 'Sow winter wheat into the prepared seedbed — aim to finish by early October.' },
  { month: 9, day: 11, emoji: '🌱', title: 'Germination', description: 'Seedlings establish; check for weeds, slugs, and pests through November.' },
  { month: 11, day: 1, emoji: '❄️', title: 'Winter Dormancy', description: 'Growth slows through December and January.' },
  { month: 1, day: 1, emoji: '🌿', title: 'Tillering & Spring Fertiliser', description: 'Extra shoots form; apply spring fertiliser through March.' },
  { month: 3, day: 1, emoji: '🌿', title: 'Stem Extension', description: 'The crop extends its stems; no field action is needed.' },
  { month: 4, day: 1, emoji: '🌾', title: 'Ear Emergence & Flowering', description: 'Ears emerge, flowers open, and crop treatments may be used through June.' },
  { month: 5, day: 15, emoji: '🌾', title: 'Grain Fill & Ripen', description: 'Grain fills and the crop turns from green to golden through July.' },
];
const eventByDate = new Map(events.map((event) => [`${event.month}-${event.day}`, event]));
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let currentSpeedIndex = 0;
let gameSpeed = SPEED_LEVELS[0];
let accumulatedGameMs = 0;
let lastRealTick = Date.now();
// While the Escape menu is open the farm clock holds still, so reading the
// credits or rebinding keys never costs the player in-game time.
let isPaused = false;

// DOM elements
const dateLabel = document.querySelector('#calendar-date');
const seasonLabel = document.querySelector('#calendar-season');
const clockLabel = document.querySelector('#calendar-clock');
const dayLabel = document.querySelector('#calendar-day');
const yearTrack = document.querySelector('#calendar-year-track');
const yearFill = document.querySelector('#calendar-year-fill');
const yearLabel = document.querySelector('#calendar-year-label');
const speedBtn = document.querySelector('#speed-btn');
const speedBtnLabel = document.querySelector('#speed-btn-label');

// Farmhouse modal elements
const farmhouseModal = document.querySelector('#farmhouse-modal');
const modalBackdrop = document.querySelector('#modal-backdrop');
const modalCloseBtn = document.querySelector('#modal-close-btn');
const modalFooterCloseBtn = document.querySelector('#modal-footer-close-btn');
const hudClock = document.querySelector('#hud-clock');
const hudDate = document.querySelector('#hud-date');
const clockHourHand = document.querySelector('#clock-hour-hand');
const clockMinuteHand = document.querySelector('#clock-minute-hand');

// Events calendar elements
const eventCalendarMonth = document.querySelector('#event-calendar-month');
const eventCalendarGrid = document.querySelector('#event-calendar-grid');
const calendarDayDetail = document.querySelector('#calendar-day-detail');
const calendarTimeTools = document.querySelector('#calendar-time-tools');
const calendarPrevMonth = document.querySelector('#calendar-prev-month');
const calendarNextMonth = document.querySelector('#calendar-next-month');
const timeSkipPrompt = document.querySelector('#time-skip-prompt');
const timeSkipSelection = document.querySelector('#time-skip-selection');
const timeSkipConfirm = document.querySelector('#time-skip-confirm');

// Tab elements
const tabEventsBtn = document.querySelector('#tab-events');
const tabMapBtn = document.querySelector('#tab-map');
const tabInventoryBtn = document.querySelector('#tab-inventory');
const tabShopBtn = document.querySelector('#tab-shop');
const tabEventsPanel = document.querySelector('#tab-events-panel');
const tabMapPanel = document.querySelector('#tab-map-panel');
const tabInventoryPanel = document.querySelector('#tab-inventory-panel');
const tabShopPanel = document.querySelector('#tab-shop-panel');
const modalTabs = document.querySelector('.modal-tabs');

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
      // Offline progress uses the normal pace, capped to two game weeks.
      const offlineRealMs = Math.max(0, now - savedLastReal);
      const offlineGameMs = Math.min(offlineRealMs * DEFAULT_SPEED, 14 * DAY_MS);
      accumulatedGameMs = savedTime + offlineGameMs;
      lastRealTick = now;
      return;
    }

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
  if (window.__farmHandsResetting) return;
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
  if (delta > 0 && !isPaused) {
    accumulatedGameMs += delta * gameSpeed;
  }
}

/** Freeze/resume the farm clock (used by the Escape menu). */
export function setGamePaused(paused) {
  advanceGameTime();
  isPaused = Boolean(paused);
  lastRealTick = Date.now();
}

export function isGamePaused() {
  return isPaused;
}

export function getGameDate() {
  advanceGameTime();
  return new Date(GAME_START + accumulatedGameMs);
}

function updateSpeedUI() {
  const speedStr = `${gameSpeed}×`;
  if (speedBtnLabel) speedBtnLabel.textContent = speedStr;
  if (speedBtn) {
    speedBtn.setAttribute('aria-label', `Game time: ${speedStr}. Click to cycle speed.`);
    if (gameSpeed > DEFAULT_SPEED) {
      speedBtn.classList.add('active-speedup');
    } else {
      speedBtn.classList.remove('active-speedup');
    }
  }
}

export function setGameSpeed(speed) {
  if (!SPEED_LEVELS.includes(speed)) return;
  advanceGameTime();
  gameSpeed = speed;
  currentSpeedIndex = SPEED_LEVELS.indexOf(speed);
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
  viewedMonth = null;
  selectedSkipDate = null;
  selectedCalendarDate = null;
  lastRenderedDayKey = '';
  updateCalendar();
  setActiveTab('events');
  modalCloseBtn?.focus();
  document.dispatchEvent(new CustomEvent('farmhouse-modal-open'));
}

function setActiveTab(name) {
  const isMap = name === 'map';
  const isInventory = name === 'inventory';
  const isEvents = name === 'events';
  const isShop = name === 'shop';
  tabEventsBtn?.classList.toggle('is-active', isEvents);
  tabMapBtn?.classList.toggle('is-active', isMap);
  tabInventoryBtn?.classList.toggle('is-active', isInventory);
  tabShopBtn?.classList.toggle('is-active', isShop);
  tabEventsBtn?.setAttribute('aria-selected', String(isEvents));
  tabMapBtn?.setAttribute('aria-selected', String(isMap));
  tabInventoryBtn?.setAttribute('aria-selected', String(isInventory));
  tabShopBtn?.setAttribute('aria-selected', String(isShop));
  if (tabEventsPanel) tabEventsPanel.hidden = !isEvents;
  if (tabMapPanel) tabMapPanel.hidden = !isMap;
  if (tabInventoryPanel) tabInventoryPanel.hidden = !isInventory;
  if (tabShopPanel) tabShopPanel.hidden = !isShop;
  if (isMap) window.FarmGame?.updateFarmMap?.();
  if (isInventory) window.FarmGame?.updateInventory?.();
  if (isShop) window.FarmGame?.updateInventory?.();
}

export function closeFarmhouseMenu() {
  if (!farmhouseModal) return;
  farmhouseModal.setAttribute('hidden', '');
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
let viewedMonth = null;
let selectedSkipDate = null;
let selectedCalendarDate = null;
let developerTimeEnabled = false;
try { developerTimeEnabled = localStorage.getItem(STORAGE_DEV_TIME_KEY) === 'on'; } catch {}

export function isDeveloperTimeEnabled() { return developerTimeEnabled; }

export function setDeveloperTimeEnabled(enabled) {
  developerTimeEnabled = Boolean(enabled);
  try {
    if (developerTimeEnabled) localStorage.setItem(STORAGE_DEV_TIME_KEY, 'on');
    else localStorage.removeItem(STORAGE_DEV_TIME_KEY);
  } catch {}
  viewedMonth = null;
  selectedSkipDate = null;
  lastRenderedDayKey = '';
  updateCalendar();
}

function renderEventCalendar(date) {
  const currentMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const shownMonth = viewedMonth ?? currentMonth;
  const shown = new Date(shownMonth);
  const month = shown.getUTCMonth();
  const year = shown.getUTCFullYear();
  const todayKey = date.toISOString().slice(0, 10);
  const detailKey = selectedCalendarDate ?? (shownMonth === currentMonth ? todayKey : new Date(shownMonth).toISOString().slice(0, 10));

  if (eventCalendarMonth) eventCalendarMonth.textContent = `${months[month]} ${year}`;
  if (calendarTimeTools) calendarTimeTools.hidden = false;
  if (calendarPrevMonth) calendarPrevMonth.disabled = shownMonth <= Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 12, 1);
  if (calendarNextMonth) calendarNextMonth.disabled = shownMonth >= Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 12, 1);
  if (timeSkipPrompt) timeSkipPrompt.hidden = !developerTimeEnabled || !selectedSkipDate;
  if (timeSkipSelection && selectedSkipDate) {
    const selected = new Date(`${selectedSkipDate}T06:00:00Z`);
    timeSkipSelection.textContent = `${months[selected.getUTCMonth()]} ${selected.getUTCDate()}, ${selected.getUTCFullYear()} · 6:00 AM`;
  }

  if (eventCalendarGrid) {
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = WEEKDAY_LABELS.map((label) => `<span class="event-cal-weekday">${label}</span>`);
    for (let i = 0; i < firstWeekday; i += 1) cells.push('<span class="event-cal-day is-empty"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const event = year === 2001 && month === 6 && day === 20 ? null : eventByDate.get(`${month}-${day}`);
      const classes = ['event-cal-day'];
      const dateKey = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
      if (dateKey === todayKey) classes.push('is-today');
      if (dateKey === detailKey) classes.push('is-selected');
      if (event) classes.push('has-event');
      const marker = event ? '<span class="event-cal-dot" aria-hidden="true">✦</span>' : '';
      const description = event ? ` title="${event.title}: ${event.description}"` : '';
      const canSkip = developerTimeEnabled && Date.UTC(year, month, day, 6) > date.getTime();
      cells.push(`<button type="button" class="${classes.join(' ')} is-skippable" data-calendar-date="${dateKey}" ${canSkip ? `data-skip-date="${dateKey}"` : ''} aria-label="Show ${months[month]} ${day}, ${year} details"${description}>${day}${marker}</button>`);
    }
    // Pad the trailing cells so the last week is complete.
    const totalCells = firstWeekday + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailingBlanks; i += 1) cells.push('<span class="event-cal-day is-empty"></span>');
    eventCalendarGrid.innerHTML = cells.join('');
  }
  if (calendarDayDetail) {
    const selected = new Date(`${detailKey}T12:00:00Z`);
    const firstFieldSummer = selected.getUTCFullYear() === 2001 && [6, 7].includes(selected.getUTCMonth());
    const event = firstFieldSummer && selected.getUTCMonth() === 6 && selected.getUTCDate() === 20 ? null : eventByDate.get(`${selected.getUTCMonth()}-${selected.getUTCDate()}`);
    const phase = farmPhase(selected);
    const heading = `${WEEKDAY_LABELS[selected.getUTCDay()]}, ${months[selected.getUTCMonth()]} ${selected.getUTCDate()}`;
    const phaseName = ({ 'harvest-prep': 'Harvest and field preparation', ripening: 'Ripening', drilling: 'Autumn sowing', establishing: 'Seedling care', dormant: 'Winter rest', tillering: 'Tillering', 'stem-extension': 'Stem growth', flowering: 'Flowering and grain formation' })[phase];
    const title = firstFieldSummer ? 'Preparing the first field' : event?.title ?? phaseName;
    const description = firstFieldSummer ? 'There is no wheat to harvest yet. Help Farmer John clear, test, and cultivate the new field. Drilling begins September 1.' : event?.description ?? phaseMessage(selected);
    calendarDayDetail.innerHTML = `<span class="calendar-detail-kicker">Field note · ${selected.getUTCFullYear()}</span><h3>${heading}</h3><strong>${title}</strong><p>${description}</p>`;
  }
}

export function isFarmhouseMenuOpen() {
  return Boolean(farmhouseModal) && !farmhouseModal.hasAttribute('hidden');
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
  const hour12 = date.getUTCHours() % 12 || 12;
  const hudClockText = `${hour12}:${pad(date.getUTCMinutes())} ${date.getUTCHours() < 12 ? 'AM' : 'PM'}`;
  const dayText = `Day ${dayOfYear} of ${daysInYear}`;

  if (dateLabel) dateLabel.textContent = dateText;
  if (seasonLabel) seasonLabel.textContent = seasonText;
  if (clockLabel) clockLabel.textContent = clockText;
  if (hudClock && hudClock.textContent !== hudClockText) {
    hudClock.textContent = hudClockText;
    hudClock.dateTime = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }
  if (hudDate) {
    const dateValue = date.toISOString().slice(0, 10);
    if (hudDate.dateTime !== dateValue) {
      hudDate.dateTime = dateValue;
      hudDate.textContent = `${months[month]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
    }
  }
  const minute = date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const hour = date.getUTCHours() % 12 + minute / 60;
  if (clockHourHand) clockHourHand.style.transform = `translateX(-50%) rotate(${hour * 30}deg)`;
  if (clockMinuteHand) clockMinuteHand.style.transform = `translateX(-50%) rotate(${minute * 6}deg)`;
  if (dayLabel) dayLabel.textContent = dayText;
  if (yearLabel) yearLabel.textContent = `Year ${gameYear}`;
  if (yearFill) yearFill.style.width = `${yearProgress}%`;
  if (yearTrack) {
    yearTrack.setAttribute('aria-valuenow', String(Math.floor(yearProgress)));
    yearTrack.setAttribute('aria-valuetext', `Day ${dayOfYear} of ${daysInYear}, Year ${gameYear}`);
  }

  // Re-render the events calendar only when the in-game day changes.
  const dayKey = `${date.getUTCFullYear()}-${month}-${date.getUTCDate()}`;
  if (dayKey !== lastRenderedDayKey) {
    lastRenderedDayKey = dayKey;
    renderEventCalendar(date);
  }
}

// Wire up events
speedBtn?.addEventListener('click', () => cycleGameSpeed());
modalCloseBtn?.addEventListener('click', () => closeFarmhouseMenu());
modalFooterCloseBtn?.addEventListener('click', () => closeFarmhouseMenu());
modalBackdrop?.addEventListener('click', () => closeFarmhouseMenu());

export function slowGameSpeed() {
  advanceGameTime();
  currentSpeedIndex = (currentSpeedIndex - 1 + SPEED_LEVELS.length) % SPEED_LEVELS.length;
  gameSpeed = SPEED_LEVELS[currentSpeedIndex];
  updateSpeedUI();
  updateCalendar();
  saveGameTime();
  return gameSpeed;
}

function pauseMenuIsOpen() {
  return document.querySelector('#pause-modal')?.hasAttribute('hidden') === false;
}

// Tab switching
tabEventsBtn?.addEventListener('click', () => setActiveTab('events'));
tabMapBtn?.addEventListener('click', () => setActiveTab('map'));
tabInventoryBtn?.addEventListener('click', () => setActiveTab('inventory'));
tabShopBtn?.addEventListener('click', () => setActiveTab('shop'));
calendarPrevMonth?.addEventListener('click', () => {
  const now = getGameDate();
  const currentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const shown = new Date(viewedMonth ?? currentMonth);
  viewedMonth = Math.max(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1), Date.UTC(shown.getUTCFullYear(), shown.getUTCMonth() - 1, 1));
  selectedSkipDate = null;
  selectedCalendarDate = null;
  renderEventCalendar(now);
});
calendarNextMonth?.addEventListener('click', () => {
  const now = getGameDate();
  const shown = new Date(viewedMonth ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  viewedMonth = Math.min(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1), Date.UTC(shown.getUTCFullYear(), shown.getUTCMonth() + 1, 1));
  selectedSkipDate = null;
  selectedCalendarDate = null;
  renderEventCalendar(now);
});
eventCalendarGrid?.addEventListener('click', (event) => {
  const day = event.target.closest('button[data-calendar-date]');
  if (!day) return;
  selectedCalendarDate = day.dataset.calendarDate;
  selectedSkipDate = developerTimeEnabled ? day.dataset.skipDate ?? null : null;
  renderEventCalendar(getGameDate());
  (selectedSkipDate ? timeSkipConfirm : calendarDayDetail)?.focus?.();
});
timeSkipConfirm?.addEventListener('click', () => {
  if (!developerTimeEnabled || !selectedSkipDate) return;
  const target = Date.parse(`${selectedSkipDate}T06:00:00Z`);
  const now = getGameDate().getTime();
  if (!Number.isFinite(target) || target <= now || target > now + 366 * DAY_MS) return;
  accumulatedGameMs = target - GAME_START;
  lastRealTick = Date.now();
  selectedSkipDate = null;
  selectedCalendarDate = null;
  viewedMonth = null;
  lastRenderedDayKey = '';
  updateCalendar();
  saveGameTime();
  document.dispatchEvent(new CustomEvent('farm-hands:time-skip'));
});
modalTabs?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const tabs = [tabEventsBtn, tabMapBtn, tabInventoryBtn, tabShopBtn];
  const currentIndex = tabs.indexOf(document.activeElement);
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  setActiveTab(['events', 'map', 'inventory', 'shop'][nextIndex]);
  event.preventDefault();
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) {
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (!document.querySelector('#farm-onboarding')?.hidden || !document.querySelector('#field-placement')?.hidden) return;
  // The Escape menu owns the keyboard while it is open (Escape itself is
  // handled in menu.js so the two modals never close each other).
  if (pauseMenuIsOpen()) return;

  // Keys are read from the rebindable keybind store (see keybinds.js).
  if (eventMatches(event, 'calendar')) {
    event.preventDefault();
    toggleFarmhouseMenu();
    return;
  }
  if (eventMatches(event, 'speedUp')) {
    event.preventDefault();
    cycleGameSpeed();
    return;
  }
  if (eventMatches(event, 'speedDown')) {
    event.preventDefault();
    slowGameSpeed();
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
  slowSpeed: slowGameSpeed,
  isPaused: isGamePaused,
  setPaused: setGamePaused,
  openFarmhouseMenu,
  closeFarmhouseMenu,
  toggleFarmhouseMenu,
  isFarmhouseMenuOpen,
  updateCalendar,
  // Dev/test helpers: read the current game date and jump the calendar.
  getDate: () => new Date(GAME_START + accumulatedGameMs),
  setDate: (utcDate) => {
    accumulatedGameMs = utcDate.getTime() - GAME_START;
    lastRealTick = Date.now();
    updateCalendar();
  },
  isDeveloperTimeEnabled,
  setDeveloperTimeEnabled,
};

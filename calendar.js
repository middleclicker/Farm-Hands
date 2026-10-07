const GAME_SPEED = 3;
const GAME_START = Date.UTC(2001, 2, 1, 6);
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'farm-hands-calendar-start-v1';
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const seasons = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'];

function loadStartTime() {
  const now = Date.now();
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
    localStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    // The calendar still runs for this session if browser storage is disabled.
  }
  return now;
}

const realStart = loadStartTime();
const dateLabel = document.querySelector('#calendar-date');
const seasonLabel = document.querySelector('#calendar-season');
const clockLabel = document.querySelector('#calendar-clock');
const dayLabel = document.querySelector('#calendar-day');
const yearTrack = document.querySelector('#calendar-year-track');
const yearFill = document.querySelector('#calendar-year-fill');
const pad = (value) => String(value).padStart(2, '0');

function updateCalendar() {
  const elapsedGameMs = Math.max(0, Date.now() - realStart) * GAME_SPEED;
  const date = new Date(GAME_START + elapsedGameMs);
  const month = date.getUTCMonth();
  const gameYear = date.getUTCFullYear() - 2000;
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const nextYear = Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), month, date.getUTCDate()) - yearStart) / DAY_MS) + 1;
  const daysInYear = (nextYear - yearStart) / DAY_MS;
  const yearProgress = (date.getTime() - yearStart) / (nextYear - yearStart) * 100;

  dateLabel.textContent = `${months[month]} ${date.getUTCDate()}`;
  seasonLabel.textContent = `${seasons[month]} · Year ${gameYear}`;
  clockLabel.textContent = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  dayLabel.textContent = `Day ${dayOfYear} of ${daysInYear}`;
  yearFill.style.width = `${yearProgress}%`;
  yearTrack.setAttribute('aria-valuenow', String(Math.floor(yearProgress)));
  yearTrack.setAttribute('aria-valuetext', `Day ${dayOfYear} of ${daysInYear}, Year ${gameYear}`);
}

updateCalendar();
setInterval(updateCalendar, 1000);

// All music and cues are original Web Audio synthesis; no external audio assets.
let context;
let muted = false;
let musicTimer = null;
let musicStarting = false;
let musicBar = 0;
let musicBus;
let musicBusConnected = false;
let shakerBuffer;
let musicHour = () => 12;
try { muted = localStorage.getItem('farm-hands-sound-muted') === 'yes'; } catch {}
const tones = {
  click: [440, 620, 0.055, 'triangle'], plan: [330, 495, 0.13, 'sine'],
  work: [145, 90, 0.18, 'triangle'], scoop: [210, 115, 0.25, 'triangle'],
  bag: [940, 310, 0.12, 'sawtooth'], engine: [95, 120, 0.18, 'sawtooth'],
  brake: [230, 90, 0.15, 'triangle'], lab: [510, 760, 0.35, 'sine'],
  mail: [660, 990, 0.33, 'sine'], book: [280, 190, 0.2, 'triangle'],
  success: [520, 780, 0.28, 'sine'], error: [250, 180, 0.15, 'triangle'],
  door: [180, 105, 0.22, 'triangle'], buy: [430, 710, 0.26, 'sine'],
};
export function playSound(name = 'click') {
  if (muted) return;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') context.resume();
    const [start, end, length, type] = tones[name] || tones.click;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(end, now + length);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(name === 'engine' ? 0.035 : 0.085, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + length + 0.01);
  } catch { /* Audio is optional if this browser blocks it. */ }
}
export function soundMuted() { return muted; }
export function setSoundMuted(value) {
  muted = Boolean(value);
  try { localStorage.setItem('farm-hands-sound-muted', muted ? 'yes' : 'no'); } catch {}
  if (muted) {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    if (musicBus && context) musicBus.gain.setTargetAtTime(0, context.currentTime, 0.08);
  }
  else if (!muted) startMusic();
}

export function setMusicHourProvider(provider) {
  if (typeof provider === 'function') musicHour = provider;
}

// Four short village themes share a key so the phrase can change with the farm
// clock without an abrupt key change. Zero marks a deliberate breath.
const musicThemes = {
  morning: {
    melody: [
      [62, 66, 69, 0, 66, 64, 66, 69],
      [71, 69, 66, 64, 62, 0, 64, 66],
      [69, 73, 74, 0, 73, 69, 66, 64],
      [66, 69, 64, 62, 0, 64, 62, 0],
    ],
    chords: [[50, 54, 57], [55, 59, 62], [47, 50, 54], [45, 49, 52]],
    bass: [38, 43, 35, 33],
    volume: 1,
  },
  day: {
    melody: [
      [66, 69, 73, 0, 74, 73, 69, 66],
      [67, 71, 74, 71, 69, 0, 67, 66],
      [64, 66, 69, 71, 69, 66, 64, 0],
      [62, 66, 69, 0, 73, 69, 66, 62],
    ],
    chords: [[50, 54, 57], [48, 52, 55], [45, 49, 52], [50, 54, 57]],
    bass: [38, 36, 33, 38],
    volume: 0.93,
  },
  evening: {
    melody: [
      [69, 66, 64, 0, 62, 64, 66, 0],
      [67, 64, 62, 0, 59, 62, 64, 0],
      [66, 64, 62, 59, 57, 0, 59, 62],
      [64, 62, 59, 0, 57, 0, 62, 0],
    ],
    chords: [[47, 50, 54], [48, 52, 55], [43, 47, 50], [45, 49, 52]],
    bass: [35, 36, 31, 33],
    volume: 0.78,
  },
  night: {
    melody: [
      [62, 0, 66, 0, 69, 0, 66, 0],
      [59, 0, 62, 0, 64, 0, 62, 0],
      [57, 0, 59, 0, 62, 0, 59, 0],
      [54, 0, 57, 0, 59, 0, 0, 0],
    ],
    chords: [[47, 50, 54], [43, 47, 50], [45, 49, 52], [47, 50, 54]],
    bass: [35, 31, 33, 35],
    volume: 0.58,
  },
};
const BAR_LENGTH = 2.4;
const midiHz = (note) => 440 * 2 ** ((note - 69) / 12);
function themeForHour(hour) {
  if (hour >= 5 && hour < 10) return musicThemes.morning;
  if (hour >= 10 && hour < 17) return musicThemes.day;
  if (hour >= 17 && hour < 21) return musicThemes.evening;
  return musicThemes.night;
}

function musicGain(at, peak, attack, release) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + release);
  gain.connect(musicBus);
  return gain;
}

function pluckedNote(note, at, volume) {
  const duration = 0.42;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3600, at);
  filter.frequency.exponentialRampToValueAtTime(900, at + duration);
  const gain = musicGain(at, 0.029 * volume, 0.008, duration);
  filter.connect(gain);
  const fundamental = context.createOscillator();
  fundamental.type = 'triangle';
  fundamental.frequency.setValueAtTime(midiHz(note) * 1.012, at);
  fundamental.frequency.exponentialRampToValueAtTime(midiHz(note), at + 0.035);
  fundamental.connect(filter);
  const overtone = context.createOscillator();
  overtone.type = 'sine';
  overtone.frequency.setValueAtTime(midiHz(note) * 2, at);
  const overtoneLevel = context.createGain();
  overtoneLevel.gain.value = 0.22;
  overtone.connect(overtoneLevel).connect(filter);
  fundamental.start(at); overtone.start(at);
  fundamental.stop(at + duration + 0.02); overtone.stop(at + duration + 0.02);
}

function chordNote(note, at, volume) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(midiHz(note), at);
  const gain = musicGain(at, 0.007 * volume, 0.22, BAR_LENGTH - 0.08);
  oscillator.connect(gain);
  oscillator.start(at); oscillator.stop(at + BAR_LENGTH);
}

function bassNote(note, at, volume) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(midiHz(note), at);
  const gain = musicGain(at, 0.019 * volume, 0.028, 0.67);
  oscillator.connect(gain);
  oscillator.start(at); oscillator.stop(at + 0.7);
}

function shaker(at, volume) {
  if (!shakerBuffer) {
    shakerBuffer = context.createBuffer(1, Math.round(context.sampleRate * 0.07), context.sampleRate);
    const data = shakerBuffer.getChannelData(0);
    let seed = 4369;
    for (let index = 0; index < data.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[index] = (seed / 2147483648 - 1) * (1 - index / data.length);
    }
  }
  const source = context.createBufferSource();
  source.buffer = shakerBuffer;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass'; highpass.frequency.value = 3600;
  source.connect(highpass).connect(musicGain(at, 0.004 * volume, 0.006, 0.065));
  source.start(at);
}

function playMusicBar() {
  if (muted || document.hidden || context.state !== 'running') return;
  const theme = themeForHour(Number(musicHour()));
  const bar = musicBar % 4;
  const at = context.currentTime + 0.05;
  theme.chords[bar].forEach((note) => chordNote(note, at, theme.volume));
  bassNote(theme.bass[bar], at, theme.volume);
  bassNote(theme.bass[bar] + 7, at + BAR_LENGTH / 2, theme.volume * 0.68);
  theme.melody[bar].forEach((note, slot) => {
    if (note) pluckedNote(note, at + slot * BAR_LENGTH / 8, theme.volume * (slot % 2 ? 0.78 : 1));
  });
  if (theme !== musicThemes.night) {
    shaker(at + BAR_LENGTH / 4, theme.volume);
    shaker(at + BAR_LENGTH * 3 / 4, theme.volume * 0.75);
  }
  musicBar += 1;
}

export function startMusic() {
  if (muted || musicTimer || musicStarting || document.hidden) return;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    musicBus ??= context.createGain();
    if (!musicBusConnected) { musicBus.connect(context.destination); musicBusConnected = true; }
    musicBus.gain.setTargetAtTime(0.68, context.currentTime, 0.12);
    musicStarting = true;
    context.resume().then(() => {
      musicStarting = false;
      if (muted || document.hidden || musicTimer) return;
      playMusicBar();
      musicTimer = setInterval(playMusicBar, BAR_LENGTH * 1000);
    }).catch(() => { musicStarting = false; });
  } catch { musicStarting = false; /* Audio remains optional when the browser blocks it. */ }
}
document.addEventListener('pointerdown', startMusic, { once: true });
document.addEventListener('keydown', startMusic, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
    musicBus?.gain.setTargetAtTime(0, context.currentTime, 0.08);
  }
  else if (!document.hidden && context) startMusic();
});

// Small procedural cues keep the farm audible without downloaded assets.
let context;
let muted = false;
let musicTimer = null;
let musicStep = 0;
try { muted = localStorage.getItem('farm-hands-sound-muted') === 'yes'; } catch {}
const tones = {
  click: [440, 620, 0.055, 'triangle'], plan: [330, 495, 0.13, 'sine'],
  work: [145, 90, 0.18, 'triangle'], scoop: [210, 115, 0.25, 'triangle'],
  bag: [940, 310, 0.12, 'sawtooth'], engine: [95, 120, 0.18, 'sawtooth'],
  brake: [230, 90, 0.15, 'triangle'], lab: [510, 760, 0.35, 'sine'],
  mail: [660, 990, 0.33, 'sine'], book: [280, 190, 0.2, 'triangle'],
  success: [520, 780, 0.28, 'sine'], error: [250, 180, 0.15, 'triangle'],
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
  if (muted && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  else if (!muted) startMusic();
}

const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23,
  261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66];
const bass = [130.81, 146.83, 164.81, 130.81];
function musicNote(frequency, at, duration, volume, type) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.01);
}
export function startMusic() {
  if (muted || musicTimer || document.hidden) return;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    context.resume();
    const playBar = () => {
      if (muted || document.hidden || context.state !== 'running') return;
      const at = context.currentTime + 0.04;
      for (let beat = 0; beat < 4; beat += 1) {
        const index = (musicStep + beat) % melody.length;
        musicNote(melody[index], at + beat * 0.45, 0.34, 0.014, 'triangle');
        if (beat % 2 === 0) musicNote(bass[Math.floor(index / 4)], at + beat * 0.45, 0.62, 0.01, 'sine');
      }
      musicStep = (musicStep + 4) % melody.length;
    };
    playBar();
    musicTimer = setInterval(playBar, 1800);
  } catch { /* Audio remains optional when the browser blocks it. */ }
}
document.addEventListener('pointerdown', startMusic, { once: true });
document.addEventListener('keydown', startMusic, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  else if (!document.hidden && context) startMusic();
});

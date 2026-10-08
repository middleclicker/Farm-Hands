// Small procedural cues keep the farm audible without downloaded assets.
let context;
let muted = false;
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
}

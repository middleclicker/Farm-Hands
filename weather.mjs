// Fictional Willow Creek weather. Summer wet-day counts follow the broad UK
// 1991–2020 pattern; the actual day sequence is deterministic for saved games.
const hash = (a, b, c) => {
  let value = Math.imul(a + 37, 73856093) ^ Math.imul(b + 19, 19349663) ^ Math.imul(c + 11, 83492791);
  value ^= value >>> 16;
  value = Math.imul(value, 2246822519);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967296;
};

export function weatherForDate(date) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const wetTarget = month === 6 ? 12 : month === 7 ? 13 : Math.round(days * (month >= 9 || month <= 2 ? 0.48 : 0.35));
  const ranked = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    score: hash(year, month, Math.floor(index / 3)) * 0.59 + hash(year, month, index + 1) * 0.41,
  })).sort((a, b) => b.score - a.score);
  const wetRank = ranked.findIndex((entry) => entry.day === day);
  const wet = wetRank < wetTarget;
  const heatwave = !wet && (month === 6 || month === 7) && hash(year, month, Math.floor((day + 1) / 5) + 99) > 0.94;
  const cloudy = !wet && !heatwave && hash(year, month, day + 300) > 0.57;
  const kind = wet ? wetRank < 2 ? 'heavy' : wetRank < 6 ? 'moderate' : 'light' : heatwave ? 'heatwave' : cloudy ? 'cloudy' : 'sunny';
  const baseline = month === 6 ? 19.6 : month === 7 ? 19.3 : month >= 4 && month <= 8 ? 17 : month >= 10 || month <= 1 ? 8 : 12;
  const highC = Math.round((baseline + (hash(year, month, day + 500) - 0.5) * 4 + (heatwave ? 6 : wet ? -1 : 0)) * 10) / 10;
  return { kind, highC, wet, label: { sunny: 'Sunny spells', cloudy: 'Cloudy', light: 'Showers', moderate: 'Steady rain', heavy: 'Heavy rain', heatwave: 'Heatwave' }[kind] };
}

export function groundTooWet(date) {
  const today = weatherForDate(date);
  if (today.kind === 'moderate' || today.kind === 'heavy') return true;
  const yesterday = new Date(date.getTime() - 86400000);
  return weatherForDate(yesterday).kind === 'heavy';
}

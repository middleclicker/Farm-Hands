// One field action at a time, following the winter wheat year.
// Dates use UTC because the game calendar is stored in UTC.
export function farmPhase(date) {
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (month === 6 && day < 20) return 'ripening';
  if (month === 6 || month === 7) return 'harvest-prep';
  if (month === 8 || (month === 9 && day <= 10)) return 'drilling';
  if (month === 9 || month === 10) return 'establishing';
  if (month === 11 || month === 0) return 'dormant';
  if (month === 1 || month === 2) return 'tillering';
  if (month === 3) return 'stem-extension';
  return 'flowering'; // May and June
}

export function allowedAction(date, state, care = {}) {
  const phase = farmPhase(date);
  if (phase === 'harvest-prep') {
    if (state === 'planted' && care.drilledYear < date.getUTCFullYear()) return 'harvest';
    if (state === 'weedy' || state === 'harvested') return 'clear';
    if (state === 'cleared') return 'test';
    if (state === 'tested') return 'cultivate';
  }
  if (phase === 'ripening' && state === 'weedy') return 'clear';
  if (phase === 'ripening' && state === 'cleared') return 'test';
  if (phase === 'ripening' && state === 'tested') return 'cultivate';
  if (phase === 'drilling' && state === 'cultivated') return 'drill';
  if (phase === 'establishing' && state === 'planted' && !care.protected) return 'protect';
  if (phase === 'tillering' && state === 'planted' && !care.fertilized) return 'fertilize';
  if (phase === 'flowering' && state === 'planted' && !care.treated) return 'treat';
  return null;
}

export function phaseMessage(date) {
  switch (farmPhase(date)) {
    case 'ripening': return 'Clear, test, and cultivate empty plots. Established grain is filling; harvest begins July 20.';
    case 'harvest-prep': return 'Harvest ripe wheat, then clear, test, and cultivate the next seedbed.';
    case 'drilling': return 'Drill winter wheat into cultivated plots by October 10.';
    case 'establishing': return 'Wheat is germinating. Tend each planted plot for weeds, slugs, and pests.';
    case 'dormant': return 'Winter wheat is dormant. There is no field work this season.';
    case 'tillering': return 'Wheat is tillering. Apply spring fertiliser to planted plots.';
    case 'stem-extension': return 'Wheat is extending its stems. Watch it grow until flowering.';
    default: return 'Wheat is flowering and forming grain. Treat planted plots if needed.';
  }
}

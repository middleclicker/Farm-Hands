import { soilReportStatus } from './soil-study.mjs';

export const SOIL_PLAN_NAMES = Object.freeze({ as_is: 'Plant as-is', targeted: 'Targeted correction', full: 'Full correction' });
export const SOIL_MATERIALS = Object.freeze([
  { key: 'lime', label: 'Agricultural lime', price: 5, unit: 'bags' },
  { key: 'sulphur', label: 'Soil sulphur', price: 6, unit: 'bags' },
  { key: 'phosphate', label: 'Phosphate', price: 5, unit: 'bags' },
  { key: 'potash', label: 'Potash', price: 5, unit: 'bags' },
  { key: 'magnesium', label: 'Magnesium amendment', price: 5, unit: 'bags' },
  { key: 'conditioner', label: 'Soil conditioner', price: 7, unit: 'bags' },
]);

export function soilIssues(report) {
  return soilReportStatus(report).results.flatMap((metric) => {
    const reading = `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
    if (metric.value < metric.idealMin) return [`${metric.label} is low (${reading})`];
    if (metric.value > metric.idealMax) return [`${metric.label} is high (${reading})`];
    return [];
  });
}

export function correctedSoilReport(report, plan) {
  const next = { ...report };
  for (const metric of soilReportStatus(report).results) {
    if (plan === 'targeted' && metric.value < metric.idealMin) next[metric.key] = metric.idealMin;
    if (plan === 'full' && !metric.ideal) next[metric.key] = metric.optimum;
  }
  return next;
}

export function soilPlanIngredients(report, plan) {
  if (!report || plan === 'as_is') return [];
  const results = soilReportStatus(report).results;
  const needed = [];
  for (const metric of results) {
    if (metric.value < metric.idealMin) {
      needed.push(metric.key === 'ph' ? 'lime' : metric.key === 'phosphorus' ? 'phosphate' : metric.key === 'potassium' ? 'potash' : 'magnesium');
    } else if (plan === 'full' && metric.key === 'ph' && metric.value > metric.idealMax) needed.push('sulphur');
  }
  if (plan === 'full' && results.some((metric) => metric.key !== 'ph' && metric.value > metric.idealMax)) needed.push('conditioner');
  return [...new Set(needed)].map((key) => ({ ...SOIL_MATERIALS.find((item) => item.key === key), quantity: 1 }));
}

export function soilQualityIndex(report, plan = 'as_is', applied = false) {
  if (!report) return null;
  const effective = applied ? correctedSoilReport(report, plan) : report;
  const results = soilReportStatus(effective).results;
  const score = results.reduce((total, metric) => {
    if (metric.ideal) return total + 100;
    const span = Math.max(1, metric.max - metric.min);
    const gap = metric.value < metric.idealMin ? metric.idealMin - metric.value : metric.value - metric.idealMax;
    return total + Math.max(15, 85 - 110 * gap / span);
  }, 0) / results.length;
  // Hand-applied amendments improve the measured nutrients, but do not make
  // the whole field as uniform as a precision-machined correction would.
  const handWorkCeiling = applied && plan === 'full' ? 90 : applied && plan === 'targeted' ? 86 : 100;
  return Math.min(Math.round(score), handWorkCeiling);
}

export function soilPlanOptions(report) {
  return [
    { id: 'as_is', name: SOIL_PLAN_NAMES.as_is, cost: 0, duration: 0, workable: soilReportStatus(report).workable, description: 'Turn under grass, break up soil, then sow. Cheapest and fastest; gaps may reduce yield.' },
    { id: 'targeted', name: SOIL_PLAN_NAMES.targeted, cost: soilPlanIngredients(report, 'targeted').reduce((sum, item) => sum + item.price * item.quantity, 0), duration: 7000, workable: soilReportStatus(correctedSoilReport(report, 'targeted')).workable, description: 'Treat low readings only. Moderate cost; addresses the main yield limit.' },
    { id: 'full', name: SOIL_PLAN_NAMES.full, cost: soilPlanIngredients(report, 'full').reduce((sum, item) => sum + item.price * item.quantity, 0), duration: 11500, workable: true, description: 'Apply every recommended amendment. More work and coins; strongest long-term soil improvement.' },
  ];
}

export function grainYieldForPlan(report, plan) {
  if (plan === 'full') return 5;
  if (plan === 'targeted') return 4;
  return soilIssues(report).length ? 3 : 4;
}

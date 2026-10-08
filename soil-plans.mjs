import { soilReportStatus } from './soil-study.mjs';

export const SOIL_PLAN_NAMES = Object.freeze({ as_is: 'Plant as-is', targeted: 'Targeted correction', full: 'Full correction' });

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

export function soilPlanOptions(report) {
  const metrics = soilReportStatus(report).results;
  const lows = metrics.filter((metric) => metric.value < metric.idealMin).length;
  const issues = metrics.filter((metric) => !metric.ideal).length;
  return [
    { id: 'as_is', name: SOIL_PLAN_NAMES.as_is, cost: 0, duration: 0, workable: soilReportStatus(report).workable, description: 'Turn under grass, break up soil, then sow. Cheapest and fastest; gaps may reduce yield.' },
    { id: 'targeted', name: SOIL_PLAN_NAMES.targeted, cost: 4 + lows * 3, duration: 7000, workable: soilReportStatus(correctedSoilReport(report, 'targeted')).workable, description: 'Treat low readings only. Moderate cost; addresses the main yield limit.' },
    { id: 'full', name: SOIL_PLAN_NAMES.full, cost: 12 + issues * 4, duration: 11500, workable: true, description: 'Apply every recommended amendment. More work and coins; strongest long-term soil improvement.' },
  ];
}

export function grainYieldForPlan(report, plan) {
  if (plan === 'full') return 5;
  if (plan === 'targeted') return 4;
  return soilIssues(report).length ? 3 : 4;
}

export const SOIL_LAB_DAY_MS = 24 * 60 * 60 * 1000;

export function soilSampleRoute(bounds) {
  const inset = 0.38;
  const left = bounds.minX + inset;
  const right = bounds.maxX - inset;
  const near = bounds.minZ + inset;
  const far = bounds.maxZ - inset;
  return Array.from({ length: 5 }, (_, index) => ({
    x: left + (right - left) * index / 4,
    z: index % 2 ? far : near,
  }));
}

export function soilReportForField(bounds) {
  const seed = Math.abs(Math.round((bounds.minX * 29 + bounds.maxX * 43 + bounds.minZ * 59 + bounds.maxZ * 71) * 100));
  return {
    ph: (5.9 + (seed % 12) / 10).toFixed(1),
    phosphorus: 16 + seed % 17,
    potassium: 115 + seed % 96,
    magnesium: 68 + seed % 69,
  };
}

export function soilReportDue(submittedAt, now) {
  return Number.isFinite(submittedAt) && now >= submittedAt + SOIL_LAB_DAY_MS;
}

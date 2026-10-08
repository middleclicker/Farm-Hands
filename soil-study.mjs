export const SOIL_LAB_DAY_MS = 24 * 60 * 60 * 1000;
export const SOIL_LAB_COST = 12;

// These are Willow Creek gameplay limits for its simulated soil test.
// The ideal intervals are informed by extension guidance but are not field advice.
export const SOIL_METRICS = Object.freeze([
  { key: 'ph', label: 'pH', unit: '', min: 5.5, max: 8.0, idealMin: 6.0, idealMax: 6.8, optimum: 6.4 },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg/kg', min: 10, max: 90, idealMin: 30, idealMax: 50, optimum: 40 },
  { key: 'potassium', label: 'Potassium', unit: 'mg/kg', min: 60, max: 300, idealMin: 100, idealMax: 150, optimum: 125 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg/kg', min: 45, max: 230, idealMin: 60, idealMax: 150, optimum: 100 },
]);

export function soilReportStatus(report) {
  const results = SOIL_METRICS.map((metric) => {
    const value = Number(report?.[metric.key]);
    return { ...metric, value, workable: Number.isFinite(value) && value >= metric.min && value <= metric.max, ideal: Number.isFinite(value) && value >= metric.idealMin && value <= metric.idealMax };
  });
  return { workable: results.every((metric) => metric.workable), results };
}

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

export function nextSoilSamplePoint(bounds, points, raw) {
  if (points.length >= 5) return null;
  const index = points.length;
  const width = bounds.maxX - bounds.minX;
  const expectedX = bounds.minX + width * index / 4;
  const expectedZ = index % 2 ? bounds.maxZ : bounds.minZ;
  if (Math.abs(raw.x - expectedX) > Math.max(0.65, width * 0.18) || Math.abs(raw.z - expectedZ) > 0.85) return null;
  return { x: Math.max(bounds.minX + 0.16, Math.min(bounds.maxX - 0.16, raw.x)), z: expectedZ + (index % 2 ? -0.16 : 0.16) };
}

export function soilCoverageAt(bounds, points, x, z) {
  if (!points.length) return 0;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const radius = Math.max(0.65, width * 0.31, depth * 0.36);
  let closest = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = points[i + 1] ?? start;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / (dx * dx + dz * dz || 1)));
    closest = Math.min(closest, Math.hypot(x - start.x - t * dx, z - start.z - t * dz));
  }
  return Math.max(0, Math.min(1, (radius * 1.3 - closest) / (radius * 0.5)));
}

export function soilCoveragePercent(bounds, points) {
  let covered = 0;
  for (let row = 0; row < 12; row += 1) for (let col = 0; col < 12; col += 1) {
    const x = bounds.minX + (bounds.maxX - bounds.minX) * (col + 0.5) / 12;
    const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * (row + 0.5) / 12;
    if (soilCoverageAt(bounds, points, x, z) >= 0.38) covered += 1;
  }
  return Math.round(covered / 144 * 100);
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

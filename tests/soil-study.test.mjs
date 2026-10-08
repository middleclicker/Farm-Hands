import test from 'node:test';
import assert from 'node:assert/strict';
import { soilSampleRoute, soilReportDue, soilReportForField, nextSoilSamplePoint, soilCoveragePercent, SOIL_LAB_DAY_MS } from '../soil-study.mjs';

test('John samples a W across the chosen field', () => {
  const route = soilSampleRoute({ minX: 0, maxX: 5, minZ: 1, maxZ: 6 });
  assert.equal(route.length, 5);
  assert.deepEqual(route.map((point) => point.z), [1.38, 5.62, 1.38, 5.62, 1.38]);
  assert.ok(route.every((point, index) => index === 0 || point.x > route[index - 1].x));
});

test('field report remains stable and takes a full game day', () => {
  const bounds = { minX: -2, maxX: 3, minZ: -1, maxZ: 4 };
  const report = soilReportForField(bounds);
  assert.deepEqual(soilReportForField(bounds), report);
  assert.ok(Number(report.ph) >= 5.9 && Number(report.ph) <= 7);
  assert.equal(soilReportDue(1000, 1000 + SOIL_LAB_DAY_MS - 1), false);
  assert.equal(soilReportDue(1000, 1000 + SOIL_LAB_DAY_MS), true);
});

test('player chooses alternating edge points and a complete W represents the field', () => {
  const bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
  const points = [];
  assert.equal(nextSoilSamplePoint(bounds, points, { x: 2, z: 2 }), null);
  assert.equal(soilCoveragePercent(bounds, points), 0);
  for (let index = 0; index < 5; index += 1) {
    const point = nextSoilSamplePoint(bounds, points, { x: -3 + index * 1.5, z: index % 2 ? 3 : -3 });
    assert.ok(point);
    points.push(point);
  }
  assert.equal(soilCoveragePercent(bounds, points), 100);
  assert.equal(nextSoilSamplePoint(bounds, points, { x: 3, z: -3 }), null);
});

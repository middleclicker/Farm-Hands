import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedSoilReport, soilIssues, soilPlanOptions, grainYieldForPlan } from '../soil-plans.mjs';

test('Charlie explains low and high readings and plans have distinct costs and outcomes', () => {
  const report = { ph: 5.2, phosphorus: 24, potassium: 185, magnesium: 95 };
  assert.deepEqual(soilIssues(report).map((issue) => issue.split(' is ')[0]), ['pH','Phosphorus','Potassium']);
  const plans = soilPlanOptions(report);
  assert.deepEqual(plans.map((plan) => plan.cost), [0,10,24]);
  assert.deepEqual(plans.map((plan) => plan.workable), [false,true,true]);
  assert.equal(correctedSoilReport(report,'targeted').ph,6);
  assert.equal(correctedSoilReport(report,'targeted').potassium,185);
  assert.equal(correctedSoilReport(report,'full').potassium,125);
  assert.deepEqual(['as_is','targeted','full'].map((plan) => grainYieldForPlan(report,plan)),[3,4,5]);
});

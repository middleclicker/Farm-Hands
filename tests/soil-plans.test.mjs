import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedSoilReport, soilIssues, soilPlanOptions, soilPlanIngredients, soilQualityIndex, grainYieldForPlan } from '../soil-plans.mjs';

test('Charlie explains low and high readings and plans have distinct costs and outcomes', () => {
  const report = { ph: 5.2, phosphorus: 24, potassium: 185, magnesium: 95 };
  assert.deepEqual(soilIssues(report).map((issue) => issue.split(' is ')[0]), ['pH','Phosphorus','Potassium']);
  const plans = soilPlanOptions(report);
  assert.deepEqual(plans.map((plan) => plan.cost), [0,10,17]);
  assert.deepEqual(plans.map((plan) => plan.workable), [false,true,true]);
  assert.deepEqual(soilPlanIngredients(report,'targeted').map((item) => item.key),['lime','phosphate']);
  assert.deepEqual(soilPlanIngredients(report,'full').map((item) => item.key),['lime','phosphate','conditioner']);
  assert.equal(soilPlanIngredients(report,'as_is').length,0);
  assert.ok(soilQualityIndex(report,'as_is',false) < soilQualityIndex(report,'targeted',true));
  assert.ok(soilQualityIndex(report,'targeted',true) < soilQualityIndex(report,'full',true));
  assert.equal(soilQualityIndex(report,'full',true),90);
  assert.equal(correctedSoilReport(report,'targeted').ph,6);
  assert.equal(correctedSoilReport(report,'targeted').potassium,185);
  assert.equal(correctedSoilReport(report,'full').potassium,125);
  assert.deepEqual(['as_is','targeted','full'].map((plan) => grainYieldForPlan(report,plan)),[3,4,5]);
});

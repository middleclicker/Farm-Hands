import assert from 'node:assert/strict';
import { allowedAction, farmPhase } from '../farming.mjs';

const date = (year, month, day = 1) => new Date(Date.UTC(year, month - 1, day));
const planted = { drilledYear: 2001 };

assert.equal(allowedAction(date(2001, 7, 1), 'weedy'), 'turn_grass');
assert.equal(allowedAction(date(2001, 8, 1), 'cleared'), 'break_soil');
assert.equal(allowedAction(date(2001, 8, 1), 'tested'), 'break_soil');
assert.equal(allowedAction(date(2001, 8, 1), 'cultivated'), null);
assert.equal(allowedAction(date(2001, 9, 1), 'cultivated'), 'drill');
assert.equal(allowedAction(date(2001, 10, 10), 'cultivated'), 'drill');
assert.equal(allowedAction(date(2001, 10, 11), 'cultivated'), null);
assert.equal(allowedAction(date(2001, 10, 11), 'planted', planted), 'protect');
assert.equal(allowedAction(date(2001, 11, 1), 'planted', { ...planted, protected: true }), null);
assert.equal(farmPhase(date(2001, 12, 1)), 'dormant');
assert.equal(allowedAction(date(2002, 1, 1), 'planted', planted), null);
assert.equal(allowedAction(date(2002, 2, 1), 'planted', planted), 'fertilize');
assert.equal(allowedAction(date(2002, 3, 1), 'planted', { ...planted, fertilized: true }), null);
assert.equal(allowedAction(date(2002, 4, 1), 'planted', planted), null);
assert.equal(allowedAction(date(2002, 5, 1), 'planted', planted), 'treat');
assert.equal(allowedAction(date(2002, 6, 1), 'planted', { ...planted, treated: true }), null);
assert.equal(allowedAction(date(2002, 7, 19), 'planted', planted), null);
assert.equal(allowedAction(date(2002, 7, 20), 'planted', planted), 'harvest');
assert.equal(allowedAction(date(2002, 7, 20), 'harvested'), 'turn_grass');
assert.equal(allowedAction(date(2002, 8, 1), 'cleared'), 'break_soil');
assert.equal(allowedAction(date(2002, 8, 1), 'tested'), 'break_soil');
assert.equal(allowedAction(date(2001, 7, 20), 'planted', planted), null);

console.log('Seasonal farming schedule passed.');

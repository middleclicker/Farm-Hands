import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherForDate, groundTooWet } from '../weather.mjs';

test('summer weather follows the calendar and reliably includes showers', () => {
  for (const [month, target] of [[6, 12], [7, 13]]) {
    const days = Array.from({ length: 31 }, (_, index) => new Date(Date.UTC(2001, month, index + 1)));
    assert.equal(days.filter((day) => weatherForDate(day).wet).length, target);
    assert.deepEqual(weatherForDate(days[4]), weatherForDate(days[4]));
    assert.ok(days.some((day) => groundTooWet(day)));
  }
});

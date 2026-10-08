import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCar, distanceToRoad } from '../driving.mjs';

function drive(initial, input, seconds, onRoad = true) {
  let car = initial;
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) car = advanceCar(car,input,0.05,onRoad);
  return car;
}

test('the player drives, steers, brakes, and reverses the car in world space', () => {
  const parked = { x: 0, z: 0, heading: 0, speed: 0, steer: 0 };
  const straight = drive(parked,{ gas: true },2);
  assert.ok(straight.z > 6);
  assert.ok(Math.abs(straight.x) < 0.01);
  const turned = drive(parked,{ gas: true, right: true },2);
  assert.ok(turned.x < -1);
  assert.ok(turned.heading < -0.3);
  const braking = drive(straight,{ brake: true },0.4);
  assert.ok(braking.speed < straight.speed);
  const reversed = drive(parked,{ brake: true },1);
  assert.ok(reversed.z < 0);
  assert.ok(reversed.speed < 0);
});

test('off-road speed is lower and road distance follows the road geometry', () => {
  const parked = { x: 0, z: 0, heading: 0, speed: 0, steer: 0 };
  assert.ok(drive(parked,{ gas: true },5).speed > drive(parked,{ gas: true },5,false).speed);
  const center = (z) => z < 8 ? -5.8 : -5.8 - Math.min(4.6,(z - 8)*0.38);
  assert.ok(distanceToRoad(center(18),18,center,52,{ x: -9.2,z: -3.15 }) < 0.1);
  assert.ok(distanceToRoad(5,18,center,52,{ x: -9.2,z: -3.15 }) > 5);
});

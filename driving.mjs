// World units are small enough that these are game-feel values, not real mph.
export function advanceCar(state, input, elapsedSeconds, onRoad = true) {
  const dt = Math.max(0, Math.min(elapsedSeconds, 0.06));
  const next = { ...state };
  const steeringInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const blend = 1 - Math.exp(-dt * 7);
  next.steer = (next.steer ?? 0) + (steeringInput - (next.steer ?? 0)) * blend;
  let speed = next.speed ?? 0;
  if (input.gas) speed += (speed < 0 ? 9 : 5.4) * dt;
  if (input.brake) speed -= (speed > 0 ? 10 : 3.5) * dt;
  if (!input.gas && !input.brake) speed *= Math.exp(-0.6 * dt);
  if (Math.abs(speed) < 0.035) speed = 0;
  speed = Math.max(-3.8, Math.min(onRoad ? 10.5 : 5.6, speed));
  const yaw = speed / 2.15 * Math.tan(next.steer * 0.58) * dt;
  next.heading += yaw;
  // Integrate at the middle heading to avoid sharp displacement on quick turns.
  next.x += Math.sin(next.heading - yaw / 2) * speed * dt;
  next.z += Math.cos(next.heading - yaw / 2) * speed * dt;
  next.speed = speed;
  return next;
}

export function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

export function distanceToRoad(x, z, roadCenter, townZ, parking) {
  let distance = distanceToSegment(x,z,parking.x,parking.z,roadCenter(-1.8),-1.8);
  for (let atZ = -3.85; atZ < townZ; atZ += 2) {
    const endZ = Math.min(townZ, atZ + 2);
    distance = Math.min(distance, distanceToSegment(x,z,roadCenter(atZ),atZ,roadCenter(endZ),endZ));
  }
  distance = Math.min(distance, distanceToSegment(x,z,roadCenter(townZ - 3.4),townZ - 3.4,roadCenter(townZ) - 3.2,townZ - 3.4));
  return distance;
}

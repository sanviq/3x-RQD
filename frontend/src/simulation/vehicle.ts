import { clamp, tire, tireContactHeight, wheelPosition } from './model';
import type { DriveState, Mark, RoadConfig, Waypoint } from './model';

/** Pose of the right front wheel, in metres. All vehicle dimensions are assumptions. */
export function wheelPose(drive: DriveState, marks: Mark[], path: Waypoint[], config: RoadConfig) {
  const position = wheelPosition(drive.z, 1, path, config), wheel = drive.wheels[1];
  const support = tireContactHeight(position.x, position.z, marks, config, position.yaw);
  const compression = Math.max(0, tire.staticDeflection + support - wheel.axle);
  return { ...position, support, compression, axleHeight: tire.radius - tire.staticDeflection + wheel.axle,
    bodyHeight: tire.radius - tire.staticDeflection + .53 + wheel.body,
    travel: wheel.axle - wheel.body, rotation: drive.distance / tire.radius,
    // Camera is attached to the sprung mass: no time-based or random shaking.
    vibration: clamp(wheel.bodyVelocity * .008 + drive.acceleration * .0005, -.012, .012) };
}

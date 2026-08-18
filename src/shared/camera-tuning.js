function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getStableBallCamRig(settings = {}) {
  const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Object.freeze({
    distance: clamp(numberOr(settings.distance, 2.95) + 0.15, 1.65, 13.15),
    height: clamp(numberOr(settings.height, 1.17) + 0.10, 0.60, 8.10),
    lookHeight: clamp(numberOr(settings.lookHeight, 0), -1, 4)
  });
}

export function getBallCamFraming(options = {}) {
  const baseDistance = clamp(Number(options.baseDistance) || 3.1, 1.65, 13.15);
  const cameraHeight = clamp(Number(options.cameraHeight) || 1.27, 0.60, 8.10);
  const carAnchorDrop = clamp(Number(options.carAnchorDrop) || 0.34, 0, 2);
  const ballHeight = Number(options.ballHeight) || 0;
  const ballForward = Number(options.ballForward) || 0;
  const ballLateral = Math.max(0, Number(options.ballLateral) || 0);
  const lookHeight = clamp(Number(options.lookHeight) || 0, -1, 4);
  const verticalFov = clamp(Number(options.verticalFovDegrees) || 72, 45, 110) * Math.PI / 180;
  // Leave eight percent of the vertical frame free at both edges. The car may
  // move toward the lower safe band for a high ball, but never beyond it.
  const verticalLimit = verticalFov * 0.42;

  const elevationsAt = (distance) => {
    const ballPlanarDistance = Math.max(0.01, Math.hypot(distance + ballForward, ballLateral));
    return {
      car: Math.atan2(-cameraHeight - carAnchorDrop, distance),
      ball: Math.atan2(ballHeight - cameraHeight, ballPlanarDistance)
    };
  };

  let distance = baseDistance;
  let elevations = elevationsAt(distance);
  const maximumSeparation = verticalLimit * 2;
  if (elevations.ball - elevations.car > maximumSeparation) {
    // Pull back only as far as required to fit both subjects. Unlike the old
    // assist this never raises the camera and cannot chase the ball vertically.
    let low = baseDistance;
    let high = Math.max(baseDistance, 24);
    for (let index = 0; index < 18; index++) {
      const middle = (low + high) * 0.5;
      const sample = elevationsAt(middle);
      if (sample.ball - sample.car > maximumSeparation) low = middle;
      else high = middle;
    }
    distance = high;
    elevations = elevationsAt(distance);
  }

  const minimumAim = elevations.ball - verticalLimit;
  const maximumAim = elevations.car + verticalLimit;
  const lookBias = Math.atan2(lookHeight, distance);
  const aimElevation = minimumAim <= maximumAim
    ? clamp(elevations.ball + lookBias, minimumAim, maximumAim)
    : (elevations.ball + elevations.car) * 0.5;

  return Object.freeze({
    distance,
    aimElevation,
    carElevation: elevations.car,
    ballElevation: elevations.ball,
    verticalLimit
  });
}

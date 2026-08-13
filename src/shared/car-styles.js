export const DEFAULT_CAR_STYLE = 'vortex';

export const CAR_STYLES = Object.freeze([
  Object.freeze({
    id: 'vortex',
    name: 'OCTANE',
    description: 'Ultra High: echtes Octane-3D-Modell · sonst Lite-Fallback',
    premiumModel: 'octane',
    bodyScale: [1.00, 1.00, 1.00],
    bodyY: 0.02,
    hoodScale: [1.00, 1.00, 1.00],
    hoodPosition: [0, 0.38, -0.87],
    cabinScale: [1.00, 1.00, 1.00],
    cabinPosition: [0, 0.66, 0.19],
    roofScale: [1.00, 1.00, 1.00],
    roofPosition: [0, 0.98, 0.25],
    bumperScale: [1.00, 1.00, 1.00],
    bumperZ: 1.50,
    spoilerScale: [1.00, 1.00, 1.00],
    spoilerPosition: [0, 0.62, 1.45],
    spoilerVisible: true,
    wheelX: 0.86,
    frontWheelZ: -0.92,
    rearWheelZ: 0.96,
    wheelRadiusScale: 1.00,
    exhaustX: 0.34,
    exhaustZ: 1.82
  }),
  Object.freeze({
    id: 'apex',
    name: 'DOMINUS',
    description: 'Ultra High: echtes Dominus-3D-Modell · sonst Lite-Fallback',
    premiumModel: 'dominus',
    bodyScale: [1.10, 0.78, 1.07],
    bodyY: -0.03,
    hoodScale: [1.08, 0.72, 1.25],
    hoodPosition: [0, 0.27, -0.82],
    cabinScale: [1.04, 0.72, 1.15],
    cabinPosition: [0, 0.48, 0.28],
    roofScale: [1.05, 0.72, 1.12],
    roofPosition: [0, 0.70, 0.32],
    bumperScale: [1.10, 0.78, 1.12],
    bumperZ: 1.58,
    spoilerScale: [1.10, 0.82, 1.20],
    spoilerPosition: [0, 0.49, 1.55],
    spoilerVisible: true,
    wheelX: 0.92,
    frontWheelZ: -1.02,
    rearWheelZ: 1.08,
    wheelRadiusScale: 0.96,
    exhaustX: 0.39,
    exhaustZ: 1.92
  }),
  Object.freeze({
    id: 'razor',
    name: 'FENNEC',
    description: 'Ultra High: echtes 3D-Modell · sonst Lite-Fallback',
    premiumModel: 'fennec',
    bodyScale: [0.98, 0.76, 1.12],
    bodyY: -0.04,
    hoodScale: [0.98, 0.62, 1.38],
    hoodPosition: [0, 0.22, -0.88],
    cabinScale: [0.94, 0.70, 0.92],
    cabinPosition: [0, 0.46, 0.42],
    roofScale: [0.92, 0.68, 0.88],
    roofPosition: [0, 0.68, 0.48],
    bumperScale: [1.00, 0.72, 1.02],
    bumperZ: 1.66,
    spoilerScale: [0.88, 0.65, 0.90],
    spoilerPosition: [0, 0.42, 1.61],
    spoilerVisible: false,
    wheelX: 0.85,
    frontWheelZ: -1.08,
    rearWheelZ: 1.16,
    wheelRadiusScale: 0.94,
    exhaustX: 0.32,
    exhaustZ: 2.00
  })
]);

export function normalizeCarStyle(value) {
  const id = String(value || '').trim().toLowerCase();
  return CAR_STYLES.some((style) => style.id === id) ? id : DEFAULT_CAR_STYLE;
}

export function getCarStyle(value) {
  const id = normalizeCarStyle(value);
  return CAR_STYLES.find((style) => style.id === id) || CAR_STYLES[0];
}

export function shouldUsePremiumCarModel(value, ultraHigh = false) {
  if (!ultraHigh) return false;
  return Boolean(getCarStyle(value)?.premiumModel);
}


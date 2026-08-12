export const BOOST_TUNING = Object.freeze({
  capacity: 100,
  consumptionPerSecond: 100 / 3,
  smallAmount: 12,
  smallRespawn: 4,
  largeRespawn: 10
});

// Rocket-League-style Soccar boost layout, scaled to this arena. The layout is
// symmetric: six full pads (four deep-corner pads plus two midfield wall pads)
// and twenty-eight small pads feeding the main attack/rotation lanes.
//
// IMPORTANT: the server mirrors these exact coordinates and IDs. Keep this
// list in sync with internal/game/world.go when changing the layout.
export const BOOST_PADS = Object.freeze([
  // Full boost pads (100).
  { id: 0, kind: 'large', x: -42, z: -66, amount: 100, radius: 2.8, respawn: 10 },
  { id: 1, kind: 'large', x:  42, z: -66, amount: 100, radius: 2.8, respawn: 10 },
  { id: 2, kind: 'large', x: -49, z:   0, amount: 100, radius: 2.8, respawn: 10 },
  { id: 3, kind: 'large', x:  49, z:   0, amount: 100, radius: 2.8, respawn: 10 },
  { id: 4, kind: 'large', x: -42, z:  66, amount: 100, radius: 2.8, respawn: 10 },
  { id: 5, kind: 'large', x:  42, z:  66, amount: 100, radius: 2.8, respawn: 10 },

  // Blue half / negative Z small pads (12).
  { id: 6,  kind: 'small', x:   0, z: -68, amount: 12, radius: 1.55, respawn: 4 },
  { id: 7,  kind: 'small', x: -24, z: -68, amount: 12, radius: 1.55, respawn: 4 },
  { id: 8,  kind: 'small', x:  24, z: -68, amount: 12, radius: 1.55, respawn: 4 },
  { id: 9,  kind: 'small', x: -13, z: -53, amount: 12, radius: 1.55, respawn: 4 },
  { id: 10, kind: 'small', x:  13, z: -53, amount: 12, radius: 1.55, respawn: 4 },
  { id: 11, kind: 'small', x:   0, z: -46, amount: 12, radius: 1.55, respawn: 4 },
  { id: 12, kind: 'small', x: -48, z: -40, amount: 12, radius: 1.55, respawn: 4 },
  { id: 13, kind: 'small', x:  48, z: -40, amount: 12, radius: 1.55, respawn: 4 },
  { id: 14, kind: 'small', x: -24, z: -37, amount: 12, radius: 1.55, respawn: 4 },
  { id: 15, kind: 'small', x:  24, z: -37, amount: 12, radius: 1.55, respawn: 4 },
  { id: 16, kind: 'small', x: -28, z: -17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 17, kind: 'small', x:   0, z: -17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 18, kind: 'small', x:  28, z: -17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 19, kind: 'small', x: -14, z:   0, amount: 12, radius: 1.55, respawn: 4 },
  { id: 20, kind: 'small', x:  14, z:   0, amount: 12, radius: 1.55, respawn: 4 },

  // Orange half / positive Z small pads (12).
  { id: 21, kind: 'small', x: -28, z:  17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 22, kind: 'small', x:   0, z:  17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 23, kind: 'small', x:  28, z:  17, amount: 12, radius: 1.55, respawn: 4 },
  { id: 24, kind: 'small', x: -24, z:  37, amount: 12, radius: 1.55, respawn: 4 },
  { id: 25, kind: 'small', x:  24, z:  37, amount: 12, radius: 1.55, respawn: 4 },
  { id: 26, kind: 'small', x: -48, z:  40, amount: 12, radius: 1.55, respawn: 4 },
  { id: 27, kind: 'small', x:  48, z:  40, amount: 12, radius: 1.55, respawn: 4 },
  { id: 28, kind: 'small', x:   0, z:  46, amount: 12, radius: 1.55, respawn: 4 },
  { id: 29, kind: 'small', x: -13, z:  53, amount: 12, radius: 1.55, respawn: 4 },
  { id: 30, kind: 'small', x:  13, z:  53, amount: 12, radius: 1.55, respawn: 4 },
  { id: 31, kind: 'small', x: -24, z:  68, amount: 12, radius: 1.55, respawn: 4 },
  { id: 32, kind: 'small', x:   0, z:  68, amount: 12, radius: 1.55, respawn: 4 },
  { id: 33, kind: 'small', x:  24, z:  68, amount: 12, radius: 1.55, respawn: 4 }
]);

// 34 bits still fit exactly inside a JavaScript Number (53-bit integer
// precision). Avoid JS bitwise operators here because those truncate to 32 bit.
export const ALL_BOOST_PADS_MASK = 2 ** BOOST_PADS.length - 1;

export function boostPadBit(id) {
  const index = Math.max(0, Math.floor(Number(id) || 0));
  return 2 ** index;
}

export function isBoostPadActive(mask, id) {
  const safeMask = Number.isFinite(Number(mask)) ? Math.max(0, Math.floor(Number(mask))) : 0;
  const bit = boostPadBit(id);
  return Math.floor(safeMask / bit) % 2 >= 1;
}

export function withBoostPadActive(mask, id, active) {
  const safeMask = Number.isFinite(Number(mask)) ? Math.max(0, Math.floor(Number(mask))) : 0;
  const bit = boostPadBit(id);
  const alreadyActive = isBoostPadActive(safeMask, id);
  if (Boolean(active) === alreadyActive) return safeMask;
  return active ? safeMask + bit : Math.max(0, safeMask - bit);
}

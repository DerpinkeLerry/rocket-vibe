export const BOOST_TUNING = Object.freeze({
  capacity: 100,
  consumptionPerSecond: 100 / 3,
  smallAmount: 20,
  smallRespawn: 4,
  largeRespawn: 10
});

// Symmetric layout: one full pad in each rounded corner plus twelve small
// pads through the main lanes. The server mirrors these exact coordinates.
export const BOOST_PADS = Object.freeze([
  { id: 0, kind: 'large', x: -43, z: -68, amount: 100, radius: 2.8, respawn: 10 },
  { id: 1, kind: 'large', x:  43, z: -68, amount: 100, radius: 2.8, respawn: 10 },
  { id: 2, kind: 'large', x: -43, z:  68, amount: 100, radius: 2.8, respawn: 10 },
  { id: 3, kind: 'large', x:  43, z:  68, amount: 100, radius: 2.8, respawn: 10 },

  { id: 4,  kind: 'small', x: -28, z: -45, amount: 20, radius: 1.65, respawn: 4 },
  { id: 5,  kind: 'small', x:   0, z: -52, amount: 20, radius: 1.65, respawn: 4 },
  { id: 6,  kind: 'small', x:  28, z: -45, amount: 20, radius: 1.65, respawn: 4 },
  { id: 7,  kind: 'small', x: -24, z: -20, amount: 20, radius: 1.65, respawn: 4 },
  { id: 8,  kind: 'small', x:   0, z: -26, amount: 20, radius: 1.65, respawn: 4 },
  { id: 9,  kind: 'small', x:  24, z: -20, amount: 20, radius: 1.65, respawn: 4 },
  { id: 10, kind: 'small', x: -24, z:  20, amount: 20, radius: 1.65, respawn: 4 },
  { id: 11, kind: 'small', x:   0, z:  26, amount: 20, radius: 1.65, respawn: 4 },
  { id: 12, kind: 'small', x:  24, z:  20, amount: 20, radius: 1.65, respawn: 4 },
  { id: 13, kind: 'small', x: -28, z:  45, amount: 20, radius: 1.65, respawn: 4 },
  { id: 14, kind: 'small', x:   0, z:  52, amount: 20, radius: 1.65, respawn: 4 },
  { id: 15, kind: 'small', x:  28, z:  45, amount: 20, radius: 1.65, respawn: 4 }
]);

export const ALL_BOOST_PADS_MASK = (1 << BOOST_PADS.length) - 1;

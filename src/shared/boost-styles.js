export const DEFAULT_BOOST_STYLE = 'solar';

export const BOOST_STYLES = Object.freeze([
  Object.freeze({
    id: 'solar',
    name: 'SOLAR',
    description: 'Heiße Flamme & Funken',
    primary: 0xff7418,
    secondary: 0xffd45b,
    core: 0xfff2c0,
    shape: 'orb',
    particleSize: 0.23,
    spawnRate: 132,
    trailSpeed: 11.5,
    spread: 0.28,
    life: 0.46,
    drag: 2.0,
    gravity: 0.45,
    flameLength: 1.12
  }),
  Object.freeze({
    id: 'ion',
    name: 'ION',
    description: 'Cyaner Energie-Strahl',
    primary: 0x14cfff,
    secondary: 0x59f6ff,
    core: 0xe8ffff,
    shape: 'diamond',
    particleSize: 0.18,
    spawnRate: 154,
    trailSpeed: 14.5,
    spread: 0.12,
    life: 0.38,
    drag: 1.6,
    gravity: 0.10,
    flameLength: 1.28
  }),
  Object.freeze({
    id: 'plasma',
    name: 'PLASMA',
    description: 'Breiter violetter Trail',
    primary: 0xb83cff,
    secondary: 0xff54d8,
    core: 0xf7d8ff,
    shape: 'ring',
    particleSize: 0.28,
    spawnRate: 112,
    trailSpeed: 9.5,
    spread: 0.42,
    life: 0.54,
    drag: 2.4,
    gravity: -0.05,
    flameLength: 1.04
  }),
  Object.freeze({
    id: 'starfall',
    name: 'STARFALL',
    description: 'Goldene Sternen-Partikel',
    primary: 0xffc52f,
    secondary: 0xfff3a1,
    core: 0xffffff,
    shape: 'star',
    particleSize: 0.20,
    spawnRate: 96,
    trailSpeed: 10.0,
    spread: 0.34,
    life: 0.62,
    drag: 1.8,
    gravity: 0.28,
    flameLength: 0.96
  })
]);

export function normalizeBoostStyle(value) {
  const id = String(value || '').trim().toLowerCase();
  return BOOST_STYLES.some((style) => style.id === id) ? id : DEFAULT_BOOST_STYLE;
}

export function getBoostStyle(value) {
  const id = normalizeBoostStyle(value);
  return BOOST_STYLES.find((style) => style.id === id) || BOOST_STYLES[0];
}

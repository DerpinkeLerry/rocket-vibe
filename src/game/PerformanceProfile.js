const MODE_NORMAL = 'normal';
const MODE_ULTRA_LOW = 'ultra-low';
const MODE_ULTRA_HIGH = 'ultra-high';

function isLikelyHandheldHardware() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
  const coarse = Boolean(window.matchMedia?.('(any-pointer: coarse)').matches);
  const shortEdge = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return navigator.maxTouchPoints > 0 && coarse && shortEdge <= 1024;
}

function safeParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const params = safeParams();
  if (params.get('mobile') === '1') return true;
  if (params.get('mobile') === '0') return false;
  return isLikelyHandheldHardware();
}

export function normalizePerformanceMode(value, mobile = isMobileDevice()) {
  const requested = String(value || '').trim().toLowerCase();
  let mode = MODE_NORMAL;
  if (['ultra', '1', 'vm', 'low', 'ultra-low', 'ultralow'].includes(requested)) mode = MODE_ULTRA_LOW;
  if (['high', 'ultra-high', 'ultrahigh', 'cinematic', 'max'].includes(requested)) mode = MODE_ULTRA_HIGH;
  if ((mobile || isLikelyHandheldHardware()) && mode === MODE_ULTRA_HIGH) return MODE_NORMAL;
  return mode;
}

export function getRememberedPerformanceMode() {
  const mobile = isMobileDevice();
  const queryMode = safeParams().get('perf');
  if (queryMode) return normalizePerformanceMode(queryMode, mobile);
  try {
    return normalizePerformanceMode(localStorage.getItem('rocket-vibe-graphics-mode'), mobile);
  } catch {
    return MODE_NORMAL;
  }
}

export function setPerformancePreference(mode) {
  const normalized = normalizePerformanceMode(mode);
  try {
    localStorage.setItem('rocket-vibe-graphics-mode', normalized);
  } catch {
    // Storage is optional; Game still receives the selected mode directly.
  }
  return normalized;
}

export function canUseUltraHigh() {
  return !isLikelyHandheldHardware();
}

export function getPerformanceProfile(networked, explicitMode = null) {
  const mobile = isMobileDevice();
  const mode = normalizePerformanceMode(explicitMode || getRememberedPerformanceMode(), mobile);
  const ultraLow = mode === MODE_ULTRA_LOW;
  const ultraHigh = mode === MODE_ULTRA_HIGH && !mobile && canUseUltraHigh();

  return {
    mode,
    name: ultraLow ? 'ULTRA LOW' : (ultraHigh ? 'ULTRA HIGH' : 'NORMAL'),
    ultra: ultraLow,
    ultraLow,
    ultraHigh,
    mobile,
    lowDetail: ultraLow,
    createClientPhysics: !networked,
    initialPixelRatio: ultraLow ? 0.48 : (ultraHigh ? 1.6 : (mobile ? 1.25 : (networked ? 0.75 : 0.9))),
    minPixelRatio: ultraLow ? 0.30 : (ultraHigh ? 1.15 : (mobile ? 0.90 : (networked ? 0.58 : 0.72))),
    maxPixelRatio: ultraLow ? 0.56 : (ultraHigh ? 2.0 : (mobile ? 1.60 : (networked ? 0.82 : 1.0))),
    adaptiveResolution: ultraLow || ultraHigh || mobile,
    predictionHz: ultraLow ? 60 : (mobile ? 90 : 120),
    hudHz: ultraLow ? 6 : (mobile ? 12 : 15),
    useFog: !ultraLow,
    useSky: true,
    useToneMapping: !ultraLow,
    antialias: ultraHigh || mobile,
    useShadows: ultraHigh,
    usePostProcessing: ultraHigh,
    useEnvironmentReflections: ultraHigh,
    highQualityMaterials: ultraHigh,
    highDetailEnvironment: ultraHigh
  };
}

export function togglePerformanceProfile() {
  if (typeof window === 'undefined') return;
  const mobile = isMobileDevice();
  const current = normalizePerformanceMode(getRememberedPerformanceMode(), mobile);
  const order = mobile
    ? [MODE_NORMAL, MODE_ULTRA_LOW]
    : [MODE_NORMAL, MODE_ULTRA_HIGH, MODE_ULTRA_LOW];
  const next = order[(order.indexOf(current) + 1) % order.length];
  setPerformancePreference(next);

  const url = new URL(window.location.href);
  if (next === MODE_NORMAL) url.searchParams.delete('perf');
  else url.searchParams.set('perf', next);
  window.location.href = url.toString();
}

export const PERFORMANCE_MODES = Object.freeze({
  NORMAL: MODE_NORMAL,
  ULTRA_LOW: MODE_ULTRA_LOW,
  ULTRA_HIGH: MODE_ULTRA_HIGH
});

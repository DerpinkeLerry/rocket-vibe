function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('mobile') === '1') return true;
  if (params.get('mobile') === '0') return false;
  return navigator.maxTouchPoints > 0 && Boolean(window.matchMedia?.('(any-pointer: coarse)').matches);
}

export function getPerformanceProfile(networked) {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('perf') || '').toLowerCase();
  const ultra = requested === 'ultra' || requested === '1' || requested === 'vm';
  const mobile = isMobileDevice();

  return {
    name: ultra ? 'ULTRA / VM' : (mobile ? 'MOBILE' : 'NORMAL'),
    ultra,
    mobile,
    lowDetail: ultra,
    createClientPhysics: !networked,
    initialPixelRatio: ultra ? 0.48 : (mobile ? 0.68 : (networked ? 0.75 : 0.9)),
    minPixelRatio: ultra ? 0.30 : (mobile ? 0.48 : (networked ? 0.58 : 0.72)),
    maxPixelRatio: ultra ? 0.56 : (mobile ? 0.82 : (networked ? 0.82 : 1.0)),
    adaptiveResolution: ultra || mobile,
    predictionHz: ultra ? 60 : (mobile ? 90 : 120),
    hudHz: ultra ? 6 : (mobile ? 12 : 15),
    useFog: !ultra,
    // The daylight dome is a single low-poly unlit draw call and stays enabled
    // even in ULTRA so the arena never falls back to a black void.
    useSky: true,
    useToneMapping: !ultra
  };
}

export function togglePerformanceProfile() {
  const url = new URL(window.location.href);
  const current = (url.searchParams.get('perf') || '').toLowerCase();
  if (current === 'ultra' || current === '1' || current === 'vm') url.searchParams.delete('perf');
  else url.searchParams.set('perf', 'ultra');
  window.location.href = url.toString();
}

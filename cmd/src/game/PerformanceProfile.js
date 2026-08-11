export function getPerformanceProfile(networked) {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('perf') || '').toLowerCase();
  const ultra = requested === 'ultra' || requested === '1' || requested === 'vm';

  return {
    name: ultra ? 'ULTRA / VM' : 'NORMAL',
    ultra,
    lowDetail: ultra,
    createClientPhysics: !networked,
    initialPixelRatio: ultra ? 0.48 : (networked ? 0.75 : 0.9),
    minPixelRatio: ultra ? 0.30 : (networked ? 0.58 : 0.72),
    maxPixelRatio: ultra ? 0.56 : (networked ? 0.82 : 1.0),
    adaptiveResolution: ultra,
    predictionHz: ultra ? 60 : 120,
    hudHz: ultra ? 6 : 15,
    useFog: !ultra,
    useSky: !ultra,
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

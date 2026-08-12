export function fullscreenElement() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreenActive() {
  return Boolean(fullscreenElement());
}

export function canRequestFullscreen(element = null) {
  if (typeof document === 'undefined') return false;
  const target = element || document.documentElement;
  return Boolean(target?.requestFullscreen || target?.webkitRequestFullscreen);
}

async function lockLandscape() {
  try {
    await globalThis.screen?.orientation?.lock?.('landscape');
  } catch {
    // iOS Safari and some embedded browsers do not expose orientation locking.
  }
}

export async function requestGameFullscreen(element = null) {
  if (typeof document === 'undefined') return false;
  if (isFullscreenActive()) {
    await lockLandscape();
    return true;
  }

  const target = element || document.documentElement;
  const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
  if (!request) {
    // Best-effort browser-chrome collapse for mobile browsers without the
    // Fullscreen API. It is not equivalent to true fullscreen, but keeps the
    // game sized to the visual viewport instead of leaving unused page space.
    try {
      window.scrollTo(0, 1);
    } catch {
      // Optional fallback only.
    }
    return false;
  }

  try {
    // Do not pass navigationUI options here: a few mobile Safari/WebView
    // implementations reject the options object and consume the user gesture.
    const result = request.call(target);
    if (result?.then) await result;
  } catch {
    return false;
  }

  await lockLandscape();
  return isFullscreenActive();
}

export async function exitGameFullscreen() {
  if (typeof document === 'undefined' || !isFullscreenActive()) return true;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return false;
  try {
    const result = exit.call(document);
    if (result?.then) await result;
    try {
      globalThis.screen?.orientation?.unlock?.();
    } catch {
      // Optional.
    }
    return !isFullscreenActive();
  } catch {
    return false;
  }
}

export async function toggleGameFullscreen(element = null) {
  if (isFullscreenActive()) return exitGameFullscreen();
  return requestGameFullscreen(element);
}

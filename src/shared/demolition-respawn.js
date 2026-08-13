export function evaluateDemolitionSnapshot({
  active = false,
  demolished = false,
  snapshotTick = -1,
  demolitionStartTick = -1,
  snapshotConfirmed = false
} = {}) {
  if (!active) {
    return { snapshotConfirmed: Boolean(snapshotConfirmed), shouldEnd: false };
  }

  const tick = Number(snapshotTick);
  const startTick = Number(demolitionStartTick);
  const hasServerTick = Number.isFinite(startTick) && startTick >= 0;
  let confirmed = Boolean(snapshotConfirmed);

  if (demolished) {
    // Modern servers stamp the demolition control message with the world tick.
    // For rolling-deploy compatibility, older servers have startTick = -1 and
    // simply confirm once any authoritative d=1 snapshot is observed.
    if (!hasServerTick || !Number.isFinite(tick) || tick >= startTick) confirmed = true;
    return { snapshotConfirmed: confirmed, shouldEnd: false };
  }

  // Control messages are written before pending snapshots. A d=0 snapshot can
  // therefore arrive *after* the demolition message even though it describes a
  // tick from before the hit. It must never close the spawn picker.
  const modernRespawn = hasServerTick && Number.isFinite(tick) && tick > startTick;
  const legacyRespawn = !hasServerTick && confirmed;
  return { snapshotConfirmed: confirmed, shouldEnd: modernRespawn || legacyRespawn };
}

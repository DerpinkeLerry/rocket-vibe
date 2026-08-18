import { BALL_TUNING } from '../shared/game-tuning.js';
import { getCarStyle } from '../shared/car-styles.js';
import { preloadPremiumBallModel } from './PremiumBallModel.js';
import { preloadPremiumCarModel } from './PremiumCarModels.js';

function initialCarStyleIds(network, identity) {
  const styles = new Set();
  if (identity?.carStyle) styles.add(identity.carStyle);
  for (const player of network?.players ?? []) {
    if (player?.carStyle) styles.add(player.carStyle);
  }
  return [...styles];
}

export function collectInitialAssetPlan({ network = null, identity = null, profile = null, gameMode = 'normal' } = {}) {
  if (!profile?.ultraHigh) return [];

  const premiumModelIds = new Set(
    initialCarStyleIds(network, identity)
      .map((styleId) => getCarStyle(styleId)?.premiumModel)
      .filter(Boolean)
  );
  const tasks = [...premiumModelIds].map((modelId) => ({
    id: `car:${modelId}`,
    label: `${modelId.toUpperCase()} wird geladen`,
    load: () => preloadPremiumCarModel(modelId)
  }));

  if (gameMode !== 'basketball') {
    tasks.push({
      id: 'ball:premium',
      label: 'Spielball wird geladen',
      load: () => preloadPremiumBallModel(BALL_TUNING.radius)
    });
  }
  return tasks;
}

// Two concurrent GLBs keep the loading stage quick without briefly multiplying
// decode/memory pressure when a lobby contains all three premium car types.
export async function preloadInitialGameAssets(options = {}) {
  const tasks = collectInitialAssetPlan(options);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (tasks.length === 0) {
    onProgress({ completed: 0, total: 0, fraction: 1, label: 'Leichte Modelle sind bereit' });
    return { loaded: [], failed: [] };
  }

  const loaded = [];
  const failed = [];
  let cursor = 0;
  let completed = 0;
  onProgress({ completed, total: tasks.length, fraction: 0, label: '3D-Modelle werden vorbereitet' });

  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        await task.load();
        loaded.push(task.id);
      } catch (error) {
        failed.push({ id: task.id, error });
      } finally {
        completed += 1;
        onProgress({
          completed,
          total: tasks.length,
          fraction: completed / tasks.length,
          label: task.label
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, worker));
  return { loaded, failed };
}

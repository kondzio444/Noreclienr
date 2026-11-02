/**
 * Module registry. Order matters only for event listeners that may delete messages (automod first).
 * Each module: { name (config key or null), commands, events, components, timers, init, ready,
 * guildReady, configChanged, stop }.
 */
const MODULES = [
  'automod', 'config', 'utility', 'nore', 'moderation', 'welcome', 'verification', 'tickets', 'suggestions',
  'applications', 'roles', 'leveling', 'giveaways', 'polls', 'reminders', 'starboard', 'custom', 'scheduled',
  'stats', 'logging', 'boosts', 'social', 'status', 'minecraft', 'configurator', 'community', 'backup',
  'builder/index', 'actions',
];

export async function loadModules() {
  const out = [];
  for (const name of MODULES) {
    const mod = (await import(`./${name}.js`)).default;
    mod.file = name;
    out.push(mod);
  }
  return out;
}

export { MODULES };

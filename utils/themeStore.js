// utils/themeStore.js
const fs = require('fs');
const path = require('path');
const THEME_PATH = path.join(__dirname, '../data/themes.json');

const defaultTheme = {
  color: '#0099ff',
  iconURL: '',
  authorName: 'Player',
  types: {
    info:    { color: '#0099ff', emoji: 'ℹ️' },
    success: { color: '#22c55e', emoji: '✅' },
    warning: { color: '#f59e0b', emoji: '⚠️' },
    error:   { color: '#ef4444', emoji: '❌' },
  },
};

function loadAll() {
  try { return JSON.parse(fs.readFileSync(THEME_PATH, 'utf8')); }
  catch { return {}; }
}
function saveAll(all) {
  fs.mkdirSync(path.dirname(THEME_PATH), { recursive: true });
  fs.writeFileSync(THEME_PATH, JSON.stringify(all, null, 2), 'utf8');
}
function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    if (typeof patch[k] === 'object' && !Array.isArray(patch[k]) && patch[k] !== null) {
      out[k] = deepMerge(base[k] || {}, patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}
function getTheme(guildId) {
  const all = loadAll();
  return deepMerge(defaultTheme, all[guildId] || {});
}
function setTheme(guildId, patch) {
  const all = loadAll();
  const merged = deepMerge(getTheme(guildId), patch);
  all[guildId] = merged;
  saveAll(all);
  return merged;
}
function resetTheme(guildId, type) {
  if (!type) return setTheme(guildId, defaultTheme);
  const all = loadAll();
  const current = getTheme(guildId);
  current.types[type] = { ...defaultTheme.types[type] };
  all[guildId] = current;
  saveAll(all);
  return current;
}

module.exports = { getTheme, setTheme, resetTheme, defaultTheme };

// utils/themeStore.js
const fs = require('fs');
const path = require('path');
const THEME_PATH = path.join(__dirname, '../data/themes.json');

const defaults = {
  color: '#0099ff',
  successColor: '#22c55e',
  errorColor: '#ef4444',
  iconURL: '',
  authorName: 'Player'
};

function loadAll() {
  try { return JSON.parse(fs.readFileSync(THEME_PATH, 'utf8')); }
  catch { return {}; }
}
function saveAll(all) {
  fs.mkdirSync(path.dirname(THEME_PATH), { recursive: true });
  fs.writeFileSync(THEME_PATH, JSON.stringify(all, null, 2), 'utf8');
}

function getTheme(guildId) {
  const all = loadAll();
  return { ...defaults, ...(all[guildId] || {}) };
}
function setTheme(guildId, patch) {
  const all = loadAll();
  all[guildId] = { ...getTheme(guildId), ...patch };
  saveAll(all);
  return all[guildId];
}

module.exports = { getTheme, setTheme };

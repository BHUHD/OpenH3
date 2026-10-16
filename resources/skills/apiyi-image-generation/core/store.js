const fs = require('node:fs');
const { configFile, stateDir, ensureDir } = require('./paths');
const { getSecretState, saveSecret, clearSecret } = require('./secrets');

function loadConfig() {
  if (!fs.existsSync(configFile())) return {};
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    throw new Error('Cannot read APIYi configuration JSON.');
  }
}

function saveConfig(config) {
  ensureDir(stateDir());
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function runtimeState() {
  const config = loadConfig();
  const secret = getSecretState();
  return {
    baseUrl: config.baseUrl || 'https://api.apiyi.com/v1',
    model: config.model || 'gpt-image-2.5-all',
    apiKey: secret.apiKey || null,
    configured: Boolean(secret.apiKey),
    secretBackend: secret.backend,
    configPath: configFile(),
  };
}

function publicState() {
  const { apiKey, ...state } = runtimeState();
  return { ...state, apiKey: apiKey ? '<saved>' : '<missing>' };
}

function clearAll() {
  clearSecret();
  if (fs.existsSync(configFile())) fs.unlinkSync(configFile());
}

module.exports = { loadConfig, saveConfig, saveSecret, runtimeState, publicState, clearAll };

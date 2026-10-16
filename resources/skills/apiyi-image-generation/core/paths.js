const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function stateDir() {
  if (process.env.APIYI_IMAGE_CONFIG_DIR) return path.resolve(process.env.APIYI_IMAGE_CONFIG_DIR);
  const bundled = path.resolve(__dirname, '../private');
  if (fs.existsSync(path.join(bundled, 'config.json'))) return bundled;
  return path.join(os.homedir(), '.openh3', 'apiyi-image-generation');
}

module.exports = {
  stateDir,
  configFile: () => path.join(stateDir(), 'config.json'),
  secretFile: () => path.join(stateDir(), 'secret.json'),
  platformName: () => process.platform,
  ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }),
};

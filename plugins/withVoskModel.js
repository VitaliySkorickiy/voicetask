const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('[withVoskModel] source missing:', src);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function withVoskModel(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const src = path.join(projectRoot, 'assets', 'model-ru');
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'model-ru'
      );
      console.log('[withVoskModel] copy', src, '->', dest);
      copyDir(src, dest);
      return cfg;
    },
  ]);
}

module.exports = withVoskModel;

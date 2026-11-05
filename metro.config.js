const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);

// Не тащить Vosk-модель в JS/OTA-бандл (она только в native assets)
config.resolver.blockList = [
  /(assets[\\/]model-ru[\\/].*)/,
];

module.exports = config;

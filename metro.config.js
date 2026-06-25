const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionListModule = require(path.join(__dirname, 'node_modules/metro-config/src/defaults/exclusionList'));
const exclusionList = exclusionListModule.default || exclusionListModule;

const config = getDefaultConfig(__dirname);
const appleDoublePattern = /(^|[/\\])\._[^/\\]*$/;

config.resolver = {
  ...config.resolver,
  blockList: exclusionList([appleDoublePattern]),
};

module.exports = config;

const { AndroidConfig, withStringsXml } = require('expo/config-plugins');

// Keep the full store name while fitting the Android launcher's icon label.
module.exports = (config) => withStringsXml(config, (mod) => {
  mod.modResults = AndroidConfig.Strings.setStringItem([
    { $: { name: 'app_name' }, _: 'Overcomers' },
  ], mod.modResults);
  return mod;
});

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // No need to list the Reanimated/Worklets plugin manually — babel-preset-expo
    // detects react-native-worklets (Reanimated v4's new runtime dependency) and
    // wires up the correct transform automatically.
    env: {
      production: {
        plugins: ['transform-remove-console'],
      },
    },
  };
};
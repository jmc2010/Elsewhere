// Babel config.
//
// This file did not exist until 2026-09-22, and its absence was silent: the
// first animated screen (the reveal, spec §14) rendered its name and buttons
// correctly but never drew the brass rule or faded in the why-line, because
// `useAnimatedStyle` was returning a style that nothing ever updated.
//
// Reanimated 4 compiles its worklets through `react-native-worklets/plugin`.
// Without it, every worklet is ordinary JavaScript that never reaches the UI
// thread, so animations do not error -- they just do nothing, which is the
// worst way for a build dependency to be missing.
//
// The plugin MUST be last in the list. That is a hard requirement of the
// plugin itself, not a style preference.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets/plugin"],
  };
};

// iPhone portrait screens: CSS size and pixel ratio. Used by splash.mjs (images) and nuxt.config.ts (link tags).
export const SPLASH = [
  [402, 874, 3], [440, 956, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2],
]
export const splashFile = (w, h, r) => `splash/${w * r}x${h * r}.png`

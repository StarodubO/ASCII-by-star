// Built-in looks. Each overrides Engine.DEFAULTS.
const PRESETS = [
  { id: "classic", name: "Classic Mono", settings: { charset: "bourke", size: 12, colorMode: "mono", fg: "#e8e8e8", bg: "#0b0b0b" } },
  { id: "terminal", name: "Green Terminal", settings: { charset: "standard", size: 12, colorMode: "mono", fg: "#33ff66", bg: "#03140a", contrast: 1.2 } },
  { id: "amber", name: "Amber CRT", settings: { charset: "bourke", size: 11, colorMode: "gradient", gradient: ["#1a0d00", "#ff9900", "#ffe0a0"], gradientMid: true, bg: "#120800" } },
  { id: "fullcolor", name: "Full Colour", settings: { charset: "bourke", size: 10, colorMode: "original", saturation: 1.25, colorBoost: 0.35, bg: "#000000" } },
  { id: "mosaic", name: "Colour Mosaic", settings: { charset: "standard", size: 14, colorMode: "original", saturation: 1.2, colorBoost: 0.5, bgMode: "mosaic", mosaicAmount: 0.3, bg: "#000000" } },
  { id: "newspaper", name: "Newspaper", settings: { charset: "bourke", size: 10, colorMode: "mono", fg: "#1a1a1a", bg: "#f2eee3", contrast: 1.15 } },
  { id: "matrix", name: "Matrix", settings: { charset: "katakana_half", size: 14, colorMode: "gradient", gradient: ["#001a00", "#00c832", "#d4ffd4"], gradientMid: true, bg: "#000800", contrast: 1.3 } },
  { id: "braille", name: "Braille Fine", settings: { charset: "braille", size: 14, detail: 0.85, colorMode: "mono", fg: "#f4f4f4", bg: "#0a0a0a", contrast: 1.35, gamma: 1.3 } },
  { id: "blocks", name: "Quadrant Blocks", settings: { charset: "quadrant", size: 12, detail: 0.9, colorMode: "original", saturation: 1.1, bg: "#000000" } },
  { id: "blueprint", name: "Blueprint", settings: { charset: "circuit", size: 12, detail: 0.7, colorMode: "mono", fg: "#e6f1ff", bg: "#0d3b66" } },
  { id: "thermal", name: "Thermal", settings: { charset: "shade", size: 10, colorMode: "gradient", gradient: ["#100020", "#ff2000", "#ffff60"], gradientMid: true, bg: "#000000" } },
  { id: "binary", name: "Binary Rain", settings: { charset: "binary", size: 10, colorMode: "gradient", gradient: ["#002000", "#00ff41", "#eaffea"], gradientMid: true, bg: "#000000", dither: "fs" } },
  { id: "halftone", name: "Dot Halftone", settings: { charset: "dots", size: 9, colorMode: "mono", fg: "#111111", bg: "#ffffff", dither: "fs" } },
  { id: "neon", name: "Neon", settings: { charset: "bourke", size: 11, colorMode: "gradient", gradient: ["#12002a", "#ff00c8", "#00f0ff"], gradientMid: true, bg: "#07000f", contrast: 1.2 } },
  { id: "gameboy", name: "Game Boy", settings: { charset: "shademix", size: 12, detail: 0.5, colorMode: "gradient", gradient: ["#0f380f", "#8bac0f", "#e0f8d0"], gradientMid: true, bg: "#0f380f" } },
  { id: "newsprint", name: "Newsprint Screen", settings: { charset: "dots", size: 7, colorMode: "mono", fg: "#151515", bg: "#f4f0e6", dither: "dot8", ditherStrength: 1 } },
  { id: "retro8", name: "Retro Ordered", settings: { charset: "shade", size: 9, colorMode: "gradient", gradient: ["#1b1035", "#e8457c", "#ffd36e"], gradientMid: true, bg: "#1b1035", dither: "bayer8" } },
  { id: "typewriter", name: "Typewriter", settings: { charset: "alnum", size: 10, colorMode: "mono", fg: "#2b2420", bg: "#efe6d2", detail: 0.4 } },
];

if (typeof module !== "undefined") module.exports = { PRESETS };

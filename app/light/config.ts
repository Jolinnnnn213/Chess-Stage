export type LightingSettings = {
  enabled: boolean;
  angle: number;
  brightness: number;
  color: string;
};

export const COLOR_PRESETS = ["#ffb36b", "#ffd9a3", "#8fdcff", "#c79cff", "#ff5f7f"] as const;

export const INITIAL_LIGHT: LightingSettings = {
  enabled: true,
  angle: 34,
  brightness: 1450,
  color: "#ffb36b",
};

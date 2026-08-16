// Widgets feature public surface (spec §8 — self-contained module).
export { default as WidgetsHub } from "./hub";
export { WidgetsRuntime } from "./runtime";
export { AchievementToastHost } from "./popper";
export { WIDGETS, getWidget } from "./registry";
export type { WidgetDef, ConfigField } from "./registry";
export { ACHIEVEMENTS } from "./achievements";

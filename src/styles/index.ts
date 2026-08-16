// Style Engine public surface. Everything the UI needs in one import path.
export * from "./types";
export * from "./wallpapers";
export * from "./catalog";
export * from "./variants";
export * from "./scenes";
export * from "./scene_styles";
export * from "./scene_twins";
export * from "./sound_schemes";
export {
  QUIZ,
  mergeAnswers,
  scoreStyle,
  rankStyles,
  buildMyStyle,
  type QuizQuestion,
} from "./quiz";

import { HERO_STYLES } from "./catalog";
import { VARIANT_STYLES } from "./variants";
import { SCENE_STYLES } from "./scene_styles";
import { SCENE_TWINS } from "./scene_twins";

/** Every style the app knows: 72 flagships + all library variants + scene
 *  styles (hand-crafted flagships and their honest twins). */
export const ALL_STYLES = [...HERO_STYLES, ...VARIANT_STYLES, ...SCENE_STYLES, ...SCENE_TWINS];

export const STYLE_COUNT = {
  flagship: HERO_STYLES.length,
  library: VARIANT_STYLES.length,
  scene: SCENE_STYLES.length + SCENE_TWINS.length,
  total: ALL_STYLES.length,
};

export function getStyle(id: string) {
  return ALL_STYLES.find((s) => s.id === id);
}

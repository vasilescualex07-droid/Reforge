// Achievement engine (spec §3, §6). Data-driven: achievements are plain
// {id, condition, title, desc, icon} entries in an array — adding one never
// touches trigger logic. Checked periodically (while any widget is enabled)
// and on relevant events (completion, hotkey triggers); the "already
// unlocked" set is persisted by the backend so nothing repeats. Simultaneous
// unlocks queue and show sequentially with a brief stagger.
import { sfxChime } from "./audio";
import { getStats } from "./stats";
import { count, getState, unlocked } from "./store";
import type { StatsSnapshot } from "./types";

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  check: (s: StatsSnapshot) => boolean;
}

// Real-stats conditions (§6): uptime milestones, process-count thresholds,
// force-quit count, cleanup totals, plus meta-achievements tied to the other
// widgets themselves (cross-widget cohesion).
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "uptime_30", title: "Warming Up", desc: "30 minutes of session time.", icon: "⏱️", check: (s) => s.uptime_secs >= 1800 },
  { id: "uptime_2h", title: "Committed", desc: "2 hours of session time.", icon: "🕑", check: (s) => s.uptime_secs >= 7200 },
  { id: "uptime_8h", title: "Marathon Mode", desc: "8 hours of session time.", icon: "🏃", check: (s) => s.uptime_secs >= 28800 },
  { id: "procs_50", title: "Crowded House", desc: "50+ processes running.", icon: "🧮", check: (s) => s.proc_count >= 50 },
  { id: "procs_120", title: "Absolute Zoo", desc: "120+ processes running.", icon: "🦒", check: (s) => s.proc_count >= 120 },
  { id: "forcequit_1", title: "The Terminator", desc: "Force-quit a process for the first time.", icon: "🪓", check: () => count("force_quits") >= 1 },
  { id: "forcequit_10", title: "Mass Eviction", desc: "Force-quit 10 processes.", icon: "🚪", check: () => count("force_quits") >= 10 },
  { id: "forcequit_50", title: "No Survivors", desc: "Force-quit 50 processes.", icon: "☠️", check: () => count("force_quits") >= 50 },
  { id: "cleanup_1", title: "First Sweep", desc: "Finish your first cleanup.", icon: "🧹", check: () => count("cleanups") >= 1 },
  { id: "cleanup_5", title: "Janitorial Regular", desc: "Finish 5 cleanups.", icon: "🧽", check: () => count("cleanups") >= 5 },
  { id: "cleanup_25", title: "Cleaning Legend", desc: "Finish 25 cleanups.", icon: "🏆", check: () => count("cleanups") >= 25 },
  { id: "cleanup_100", title: "The Dust Will Not Return", desc: "Finish 100 cleanups.", icon: "💎", check: () => count("cleanups") >= 100 },
  { id: "rage_first", title: "Screen-Deep", desc: "Trigger Rage Shatter for the first time.", icon: "🪟", check: () => count("rage_uses") >= 1 },
  { id: "rage_10", title: "Fragmentation Pro", desc: "Shatter your screen 10 times.", icon: "🧩", check: () => count("rage_uses") >= 10 },
  { id: "boss_first", title: "Very Important Business", desc: "Use the Boss Key for the first time.", icon: "📊", check: () => count("boss_uses") >= 1 },
  { id: "boss_10", title: "Executive Material", desc: "Use the Boss Key 10 times.", icon: "🕴️", check: () => count("boss_uses") >= 10 },
  { id: "confetti_first", title: "Small Victory Parade", desc: "Fire the Confetti Cannon once.", icon: "🎊", check: () => count("confetti_fired") >= 1 },
  { id: "confetti_10", title: "Parade Marshal", desc: "Fire the Confetti Cannon 10 times.", icon: "🎪", check: () => count("confetti_fired") >= 10 },
  { id: "bsod_first", title: "Blue Skies Ahead", desc: "Summon the fake BSOD once.", icon: "💙", check: () => count("bsod_uses") >= 1 },
  { id: "glitch_first", title: "Signal Lost", desc: "Trigger Glitch Jumpscare once.", icon: "📡", check: () => count("glitch_uses") >= 1 },
  { id: "fire_first", title: "Overheating Enthusiast", desc: "Survive a CPU fire alarm.", icon: "🔥", check: () => count("fire_fired") >= 1 },
  { id: "roast_first", title: "Gracefully Roasted", desc: "Get roasted by the Idle Roast.", icon: "🍳", check: () => count("roasts") >= 1 },
  { id: "smash_first", title: "Keyboard Abuse Survivor", desc: "Trigger the Keyboard Smash Detector.", icon: "⌨️", check: () => count("smash_hits") >= 1 },
  { id: "cert_first", title: "Officially Certified", desc: "Print a Procrastination Certificate.", icon: "📜", check: () => count("cert_count") >= 1 },
  { id: "whip_25", title: "Crack Shot", desc: "Crack the whip 25 times.", icon: "🐍", check: () => count("whip_cracks") >= 25 },
  { id: "whip_100", title: "Whip Whisperer", desc: "Crack the whip 100 times.", icon: "🤠", check: () => count("whip_cracks") >= 100 },
  { id: "pet_first", title: "Pet Person", desc: "Summon the Desktop Pet.", icon: "🐾", check: () => count("pet_sessions") >= 1 },
  { id: "hoarder", title: "Full House", desc: "Have all 12 widgets enabled at once.", icon: "🏠", check: () => getState().enabled.length >= 12 },
];

// ---- toast queue (sequential, staggered — never stacked) -------------------
export interface QueuedAchievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
}

const queue: QueuedAchievement[] = [];
const subs = new Set<(q: QueuedAchievement[]) => void>();
let draining = false;

export function subscribeQueue(fn: (q: QueuedAchievement[]) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emitQueue() {
  for (const fn of subs) fn([...queue]);
}

export function getQueue(): QueuedAchievement[] {
  return [...queue];
}

/** One check pass: unlock anything whose condition is met, enqueue new ones. */
export async function checkAchievements(): Promise<void> {
  const s = getStats();
  const fresh: QueuedAchievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked(a.id)) continue;
    let ok = false;
    try {
      ok = a.check(s);
    } catch {
      ok = false;
    }
    if (ok) {
      const newly = await unlockAndRecord(a.id);
      if (newly) fresh.push({ id: a.id, title: a.title, desc: a.desc, icon: a.icon });
    }
  }
  if (fresh.length > 0) {
    queue.push(...fresh);
    emitQueue();
    if (!draining) drainQueue();
  }
}

async function unlockAndRecord(id: string): Promise<boolean> {
  try {
    return await import("./store").then((m) => m.unlockAchievement(id));
  } catch {
    return false;
  }
}

/** Show one toast at a time; the next follows after a brief stagger. The
 *  popper renders queue[0]; this drain shifts it and chimes for the next. */
function drainQueue(): void {
  draining = true;
  const step = () => {
    const item = queue.shift();
    if (!item) {
      draining = false;
      emitQueue();
      return;
    }
    emitQueue();
    sfxChime({ gain: 0.16 });
    setTimeout(step, 2400); // stagger between sequential toasts
  };
  step();
}

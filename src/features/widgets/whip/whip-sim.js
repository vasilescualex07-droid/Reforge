/*
 * Whip Cracker — self-contained simulation + rendering + audio module.
 *
 * Portable: works in a plain browser tab AND inside the Tauri overlay. The
 * physics (Verlet chain + crack detection) is pure math with an injectable
 * clock, so node tests can drive it deterministically.
 *
 * Structure (per spec §7):
 *   - WhipCracker.engine.create(cfg)  → pure simulation
 *   - WhipCracker.renderer.create(canvas) → all canvas draw calls
 *   - WhipCracker.audio.create()      → Web Audio (whoosh / crack / voice)
 *   - app.js owns input + the RAF loop and wires the three together.
 *
 * Tunables live at the top of each section (§7): CRACK_THRESHOLD, COOLDOWN_MS,
 * segment count and damping are named constants.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WhipCracker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // TUNABLES — the knobs you will actually turn after first playtest (§7)
  // ===========================================================================
  const CONFIG = {
    // ---- chain (Verlet) ----
    SEGMENTS: 14, // number of chain segments; points = SEGMENTS + 1 (12-16 per spec)
    SEGMENT_LENGTH: 42, // px per segment → whip ≈ 590px
    SOLVER_ITERATIONS: 14, // relaxation passes per frame — stiffer = less floppy
    DAMPING: 0.955, // energy kept per frame — lower = settles fast, no lingering wobble
    GRAVITY: 600, // px/s² downward — the idle whip hangs nearly straight
    TAPER: 0.8, // 0..1 — how much the constraint split favors the tip (amplification)
    // ---- 3-zone bend (shared canonical model: rigid stock → tapered mid →
    // limber cracker). Stiffness is per-zone so the handle end stays a rigid
    // rod while the tip stays free to lash — the anti-flop. Capped so the
    // bend perturbation never breaks segment rest-length integrity. ----
    BEND_STOCK: 0.2, // rigid stock zone stiffness (w < 0.25)
    BEND_MID_TOP: 0.18, // tapered mid start stiffness (w = 0.25)
    BEND_MID_BOTTOM: 0.11, // tapered mid end stiffness (w = 0.70) — retuned 0.09→0.11 (less flimsy)
    BEND_TAIL_TOP: 0.1, // limber tail start stiffness (w = 0.70) — retuned 0.08→0.10
    BEND_TAIL_BOTTOM: 0.04, // cracker end stiffness (w = 1.0) — retuned 0.02→0.04
    MAX_DT: 1 / 30, // clamp simulation dt (tab-switch / frame hitch guard)

    // ---- classic canonical physics (restored) — the per-frame Verlet recipe
    // both projects shipped at 1.0. The v2 fixed-timestep experiment made the
    // whip feel like a steel rod with a noodle tail, so it's gone. Damping,
    // gravity and the 3-zone bend run once per frame at display rate. ----

    // ---- physics feel pass (FINAL_RELEASE_PLAN §0.1) — the final physics
    // upgrade keeps the classic core and changes what it PRODUCES. ----
    // Grip torque: on a handle direction reversal, the whole whip keeps its
    // curve for a few ms so the coil survives the turn (bend-lag relief).
    // NOTE: per-frame timing like the classic core — display-rate dependent
    // on purpose (the v2 fixed-timestep "fix" is what got reverted).
    BEND_LAG_K: 0.6, // bend strength reduction while lagging
    BEND_LAG_MS: 150, // how long a reversal keeps the whip coiled
    // Tail droop: while the hand is still, the limber tail's bend relaxes so
    // the cracker falls into a natural hang (the stock stays a rigid rod).
    SETTLE_MIN: 60, // handle px/s below which the whip counts as settling
    TAIL_DROOP_K: 0.4, // tail-zone bend strength reduction while settling
    // NOTE (§0.1.1): the natural momentum wave needs no mechanism — probing
    // showed the classic sim already runs a wave handle→tip (the fold peak
    // travels down the chain during a lash; it is momentum + the tapered
    // constraint split, not the bend). Bend-relaxation or taper knobs are a
    // no-op (measured), and injecting a kink is exactly the v2 mistake. The
    // wave is LOCKED IN by a regression test instead.

    // ---- crack detection (wavefront reversal + amplification) ----
    // A real whip crack is the tip SNAPPING BACK against its own wavefront:
    // the tip's velocity direction flips sharply (the sim's genuine crack
    // flip is ~85-90°, so the gate is set at ~75° for margin) as the momentum
    // wave reflects. The amplification ratio then guards the steady-drag
    // case — the tip must ALSO outrun the handle, which a constant drag
    // (tip ≈ handle) can never do, while a genuine lash (handle stopped, tip
    // flying) trivially clears it.
    // Tuned from 3000 → 2000 px/s: a real human swing lands 1500-4000 px/s,
    // so 3000 required a violent flick every time. 2000 means a solid,
    // satisfying swing cracks reliably without the whip going off from idle
    // jiggle (wind-up still gates the twitchy case).
    CRACK_THRESHOLD: 2000, // px/s tip speed at the reversal to count
    REVERSAL_DOT: 0.26, // dot(wavefront, curDir) < 0.26 → flipped >~75°
    REVERSAL_WINDOW_MS: 90, // the wavefront = tip direction this far back
    REVERSAL_SPEED_MIN: 80, // ignore direction noise while the tip crawls
    AMPLIFY_RATIO: 1.6, // tip must outrun the handle by this ratio to crack
    MIN_WINDUP: 160, // px of handle travel required since last crack/reset
    CRACK_POWER_EXP: 0.55, // velocity-excess → crack power curve (VFX only, not physics)
    COOLDOWN_MS: 380, // no new crack within this window (spec: 350-400ms)
    GRAB_HITZONE_RADIUS: 26, // px around the grip that starts a drag
    RELEASE_EASE_MS: 250, // handle eases back to the anchor after release

    // ---- trail + look (black, detailed) ----
    TRAIL_MS: 220, // tip glow-trail lifetime
    HANDLE_WIDTH: 11, // stroke width at the handle end
    TIP_WIDTH: 1.6, // stroke width at the tip end
    HANDLE_COLOR: "#17171b", // black grip
    BODY_COLOR: "#0c0c0f", // near-black body
    TIP_COLOR: "#e8e8ee", // pale tip (the part that cracks)
    HIGHLIGHT_COLOR: "rgba(122,122,132,0.5)", // edge highlight for roundness
    BRAID_COLOR: "rgba(96,96,104,0.55)", // rope-braid texture dashes
    GRIP_WRAP_COLOR: "#2c2c31", // wrapped-leather grip band
    FERRULE_COLOR: "#9a9aa2", // steel ferrule ring at the grip end
  };

  // ===========================================================================
  // WHIP PROFILES (physics v2) — a whip is now a family of objects. The base
  // profile (Classic Bullwhip) IS the canonical spec; the others override
  // segments/length/stiffness/taper so the FEEL differs. Both projects ship
  // these exact three profiles (verified by check-whip-consistency.mjs).
  // ===========================================================================
  const PROFILES = {
    bullwhip: {
      id: "bullwhip",
      name: "Classic Bullwhip",
      desc: "The canonical feel — rigid stock, limber tail, one clean crack.",
      SEGMENTS: 14,
      SEGMENT_LENGTH: 42,
      TAPER: 0.8,
      BEND_STOCK: 0.2,
      BEND_MID_TOP: 0.18,
      BEND_MID_BOTTOM: 0.11,
      BEND_TAIL_TOP: 0.1,
      BEND_TAIL_BOTTOM: 0.04,
      CRACKER: 1.0, // cracker-tuft size multiplier (renderer)
      GRAB_HITZONE_RADIUS: 26,
    },
    snakewhip: {
      id: "snakewhip",
      name: "Snakewhip",
      desc: "Short, light and limber everywhere — fast snaps, less power.",
      SEGMENTS: 10,
      SEGMENT_LENGTH: 38,
      TAPER: 0.7,
      BEND_STOCK: 0.16,
      BEND_MID_TOP: 0.16,
      BEND_MID_BOTTOM: 0.1,
      BEND_TAIL_TOP: 0.09,
      BEND_TAIL_BOTTOM: 0.04,
      CRACKER: 1.2,
      GRAB_HITZONE_RADIUS: 24,
    },
    stockwhip: {
      id: "stockwhip",
      name: "Stockwhip",
      desc: "Longer rigid stock, heavier taper — a hard, deliberate crack.",
      SEGMENTS: 16,
      SEGMENT_LENGTH: 44,
      TAPER: 0.85,
      BEND_STOCK: 0.26,
      BEND_MID_TOP: 0.22,
      BEND_MID_BOTTOM: 0.1,
      BEND_TAIL_TOP: 0.09,
      BEND_TAIL_BOTTOM: 0.02,
      CRACKER: 0.9,
      GRAB_HITZONE_RADIUS: 28,
    },
  };

  // ===========================================================================
  // THEMES (model v2) — the widget's material palettes. The renderer merges
  // these over CONFIG's colors so every pass is theme-driven.
  // ===========================================================================
  const THEMES = {
    midnight: {
      id: "midnight",
      name: "Midnight",
      HANDLE_COLOR: "#17171b",
      BODY_COLOR: "#0c0c0f",
      TIP_COLOR: "#e8e8ee",
      HIGHLIGHT_COLOR: "rgba(122,122,132,0.5)",
      BRAID_COLOR: "rgba(96,96,104,0.55)",
      GRIP_WRAP_COLOR: "#2c2c31",
      FERRULE_COLOR: "#9a9aa2",
      POM_COLOR: "#0b0b0e",
      POM_HI: "rgba(170,170,180,0.35)",
      CRACKER_COLOR: "rgba(238,238,244,0.95)",
    },
    ember: {
      id: "ember",
      name: "Ember",
      HANDLE_COLOR: "#3a1c10",
      BODY_COLOR: "#7a2e14",
      TIP_COLOR: "#ffd9a0",
      HIGHLIGHT_COLOR: "rgba(255,150,60,0.5)",
      BRAID_COLOR: "rgba(255,120,50,0.5)",
      GRIP_WRAP_COLOR: "#4a2410",
      FERRULE_COLOR: "#d8a06a",
      POM_COLOR: "#2a1208",
      POM_HI: "rgba(255,180,110,0.4)",
      CRACKER_COLOR: "rgba(255,230,190,0.95)",
    },
    frost: {
      id: "frost",
      name: "Frost",
      HANDLE_COLOR: "#12202a",
      BODY_COLOR: "#1c3c4d",
      TIP_COLOR: "#dff6ff",
      HIGHLIGHT_COLOR: "rgba(120,220,255,0.5)",
      BRAID_COLOR: "rgba(120,200,235,0.5)",
      GRIP_WRAP_COLOR: "#16282f",
      FERRULE_COLOR: "#a8cfe0",
      POM_COLOR: "#0c161c",
      POM_HI: "rgba(190,240,255,0.4)",
      CRACKER_COLOR: "rgba(225,248,255,0.95)",
    },
    toxic: {
      id: "toxic",
      name: "Toxic",
      HANDLE_COLOR: "#14240c",
      BODY_COLOR: "#2c5518",
      TIP_COLOR: "#e2ffc8",
      HIGHLIGHT_COLOR: "rgba(150,255,120,0.5)",
      BRAID_COLOR: "rgba(140,230,110,0.5)",
      GRIP_WRAP_COLOR: "#182e0e",
      FERRULE_COLOR: "#a8d68a",
      POM_COLOR: "#0e1c06",
      POM_HI: "rgba(190,255,160,0.4)",
      CRACKER_COLOR: "rgba(235,255,220,0.95)",
    },
  };

  /** Crack power v2.5 (§0.1.5) — the shared canonical formula, exported so
   *  both projects unit-test the SAME math: how far the tip clears the
   *  threshold at the reversal (raw) × how sharply the direction flipped
   *  (sharp = 1 − dot(wavefront, current), 0..2). The firing gate already
   *  requires a sharp flip (dot < REVERSAL_DOT), so the /1.6 spans the whole
   *  firing band: a grazing gate-hugger lands weak, a full snap lands 1.0. */
  function crackPower(raw, sharp, exp) {
    return (
      Math.min(1, Math.pow(Math.max(0, raw) * 1.5, exp)) *
      (0.5 + 0.5 * Math.min(1, Math.max(0, sharp) / 1.6))
    );
  }

  // ===========================================================================
  // ENGINE — pure Verlet simulation (no DOM, injectable clock)
  // ===========================================================================
  const engine = {
    create(cfg) {
      const profId = cfg && cfg.profile ? cfg.profile : "bullwhip";
      const prof = PROFILES[profId] || PROFILES.bullwhip;
      const c = Object.assign({}, CONFIG, prof, cfg || {});
      c.profileId = prof.id;
      const N = c.SEGMENTS + 1;
      const now = c.now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

      /** 3-zone bend stiffness: rigid stock (0–25%), tapered mid (25–70%),
       *  limber tail + cracker (70–100%). */
      function bendK(w) {
        if (w < 0.25) return c.BEND_STOCK;
        if (w < 0.7) {
          const t = (w - 0.25) / 0.45;
          return c.BEND_MID_TOP + (c.BEND_MID_BOTTOM - c.BEND_MID_TOP) * t;
        }
        const t = Math.min(1, (w - 0.7) / 0.3);
        return c.BEND_TAIL_TOP + (c.BEND_TAIL_BOTTOM - c.BEND_TAIL_TOP) * t;
      }

      /** Distance-constraint relaxation passes (Jakobsen, tapered). The
       *  tip-side absorbs more of each correction → momentum piles up at the
       *  tip for free — that is the whip-crack amplification. Re-pins the
       *  kinematic handle after every pass. */
      function relax(iterations, hx0, hy0) {
        for (let iter = 0; iter < iterations; iter++) {
          for (let i = 1; i < N; i++) {
            const a = points[i - 1];
            const b = points[i];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) {
              dx = 1;
              dy = 0;
              dist = 1;
            }
            const diff = (dist - c.SEGMENT_LENGTH) / dist;
            const w = i / (N - 1); // 0 at handle → 1 at tip
            const tailShare = 0.5 + c.TAPER * w * 0.5; // 0.5 → ~0.9
            a.x += dx * diff * (1 - tailShare);
            a.y += dy * diff * (1 - tailShare);
            b.x -= dx * diff * tailShare;
            b.y -= dy * diff * tailShare;
          }
          // The handle is KINEMATIC while held (§1) — the solver must never
          // move it. Re-pin after every relaxation pass so it behaves as an
          // infinite-mass anchor and the cursor position is exact.
          points[0].x = hx0;
          points[0].y = hy0;
          points[0].px = hx0;
          points[0].py = hy0;
        }
      }
      let points = [];
      let tipPrev = { x: 0, y: 0 };
      let dirHistory = []; // recent tip directions (the wavefront history)
      let wasFired = false; // rising edge of the crack condition
      let lastCrackAt = -Infinity;
      let windup = 0;
      let lastHandle = { x: 0, y: 0 };
      let dragging = false;
      let trail = [];
      let tipVelocity = 0;
      // Idle rest pose (§2a): the whip hangs from a fixed anchor when not held.
      // While idle the handle rests at the anchor; on release it eases back.
      let anchor = { x: 0, y: 0 };
      let easing = false;
      let easeFrom = { x: 0, y: 0 };
      let easeAt = 0;
      // physics feel pass (§0.1): handle-velocity history for the grip-lag
      // reversal gate and the bend-lag timer.
      let lastHVx = 0;
      let lastHVy = 0;
      let lagUntil = -Infinity;

      function reset(hx, hy) {
        points = [];
        // Lay the whip into a natural straight hang instead of a collapsed
        // dot. A collapsed start is a degenerate local minimum the bend +
        // relax passes cannot escape — the chain locks into an accordion
        // fold (measured 180° at every segment, test AND shipped configs;
        // only the widget's idle sway happened to perturb it out). Starting
        // straight, gravity keeps it straight forever.
        for (let i = 0; i < N; i++) {
          points.push({ x: hx, y: hy + i * c.SEGMENT_LENGTH, px: hx, py: hy + i * c.SEGMENT_LENGTH });
        }
        tipPrev = { x: hx, y: hy + (N - 1) * c.SEGMENT_LENGTH };
        windup = 0;
        lastHandle = { x: hx, y: hy };
        trail = [];
        tipVelocity = 0;
        dirHistory = [];
        wasFired = false;
        lastCrackAt = -Infinity;
        easing = false;
        lastHVx = 0;
        lastHVy = 0;
        lagUntil = -Infinity;
      }

      function setDragging(d) {
        dragging = d;
        windup = 0;
        if (d) easing = false; // a fresh grab cancels the return-home ease
      }

      function setAnchor(x, y) {
        anchor = { x, y };
      }

      /** Begin the release ease-back (§2a): handle interpolates to the anchor. */
      function release() {
        if (!dragging) return;
        dragging = false;
        windup = 0;
        const h = points.length ? points[0] : anchor;
        easeFrom = { x: h.x, y: h.y };
        easeAt = now();
        easing = true;
      }

      /** True when (x, y) is inside the grip hit-zone (spec §2a). */
      function withinGrab(x, y) {
        const h = points.length ? points[0] : anchor;
        return Math.hypot(x - h.x, y - h.y) <= c.GRAB_HITZONE_RADIUS;
      }

      /**
       * One simulation step — the CLASSIC per-frame recipe restored after the
       * v2 fixed-timestep experiment (the whip felt like a steel rod with a
       * noodle tail). Damping, gravity and the 3-zone bend run once per frame
       * at the display rate, exactly as the 1.0 release that felt right.
       * Returns a crack event (or null): { x, y, vx, vy, tipVelocity, power }.
       */
      function step(dt, hx, hy) {
        if (!points.length) reset(hx, hy);
        const t = Math.min(dt, c.MAX_DT);
        const t2 = t * t;
        const nowMs = now();

        // Resolve where the handle goes this frame (§2a): dragging → the live
        // cursor; releasing → ease back to the anchor; idle → rest at the
        // anchor. Only a HELD whip is kinematic.
        let hx0, hy0;
        if (dragging) {
          hx0 = hx;
          hy0 = hy;
        } else if (easing) {
          const nowMs = now();
          const k = Math.min(1, (nowMs - easeAt) / c.RELEASE_EASE_MS);
          const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
          hx0 = easeFrom.x + (anchor.x - easeFrom.x) * e;
          hy0 = easeFrom.y + (anchor.y - easeFrom.y) * e;
          if (k >= 1) easing = false;
        } else {
          hx0 = anchor.x;
          hy0 = anchor.y;
        }
        points[0].x = hx0;
        points[0].y = hy0;
        points[0].px = hx0;
        points[0].py = hy0;

        // handle velocity THIS frame — from the PREVIOUS call's handle (must
        // run before lastHandle is overwritten); wind-up accumulates the
        // handle's path length since the last crack/reset.
        const handleVx = (hx0 - lastHandle.x) / t;
        const handleVy = (hy0 - lastHandle.y) / t;
        const handleVel = Math.sqrt(handleVx * handleVx + handleVy * handleVy);
        if (dragging) {
          windup += Math.sqrt((hx0 - lastHandle.x) ** 2 + (hy0 - lastHandle.y) ** 2);
        }
        // grip torque (§0.1.2): a handle direction reversal keeps the whip
        // coiled for BEND_LAG_MS — the coil survives the turn instead of
        // being straightened mid-swing.
        if (dragging && handleVel > 40 && lastHVx * handleVx + lastHVy * handleVy < 0) {
          lagUntil = nowMs + c.BEND_LAG_MS;
        }
        lastHVx = handleVx;
        lastHVy = handleVy;
        lastHandle = { x: hx0, y: hy0 };

        let event = null;

        // Verlet integrate the dynamic points (classic recipe)
        for (let i = 1; i < N; i++) {
          const p = points[i];
          const vx = (p.x - p.px) * c.DAMPING;
          const vy = (p.y - p.py) * c.DAMPING;
          p.px = p.x;
          p.py = p.y;
          p.x += vx;
          p.y += vy + c.GRAVITY * t2;
        }

        // distance constraints (tapered, classic)
        relax(c.SOLVER_ITERATIONS, hx0, hy0);

        // 3-zone angular (bend) constraint — the shared canonical anti-flop.
        // Each interior point is pulled toward the midpoint of its
        // neighbours; stiffness comes from the zone model (rigid stock →
        // tapered mid → limber cracker) so the handle end stays a rigid rod
        // while the tip stays free to lash. Applied ONCE per frame with
        // pos + prev moved together, so the implied Verlet velocity is
        // preserved — the whip straightens without swallowing the momentum
        // that produces the crack. The feel pass (§0.1) modulates the
        // strength: bend-lag relief through handle reversals, and settle
        // droop on the limber tail while the hand is still.
        const lagging = nowMs < lagUntil;
        const settling = handleVel < c.SETTLE_MIN;
        for (let i = 1; i < N - 1; i++) {
          const a = points[i - 1];
          const b = points[i];
          const d = points[i + 1];
          const w = i / (N - 1);
          let k = bendK(w);
          if (lagging) k *= 1 - c.BEND_LAG_K;
          if (settling && w > 0.7) k *= 1 - c.TAIL_DROOP_K;
          const dx = ((a.x + d.x) * 0.5 - b.x) * k;
          const dy = ((a.y + d.y) * 0.5 - b.y) * k;
          b.x += dx;
          b.y += dy;
          b.px += dx;
          b.py += dy;
        }
        // The handle stays pinned after the bend pass too (it is kinematic).
        points[0].x = hx0;
        points[0].y = hy0;
        points[0].px = hx0;
        points[0].py = hy0;
        // Two short relaxation passes after the bend keep every segment at
        // rest length — the stiff stock zone otherwise compresses segments.
        relax(2, hx0, hy0);        // ---- crack detection (per spec §2: wavefront reversal) ----
        const tip = points[N - 1];
        const vx = (tip.x - tipPrev.x) / t;
        const vy = (tip.y - tipPrev.y) / t;
        tipVelocity = Math.sqrt(vx * vx + vy * vy);
        tipPrev = { x: tip.x, y: tip.y };

        // Record the tip's motion direction while it is actually moving; a
        // stopped tip has no wavefront. The history IS the wavefront — the
        // direction the tip was travelling REVERSAL_WINDOW_MS ago.
        const spd = Math.hypot(vx, vy) || 1;
        const curDirX = vx / spd;
        const curDirY = vy / spd;
        if (tipVelocity > c.REVERSAL_SPEED_MIN) {
          dirHistory.push({ x: curDirX, y: curDirY, at: nowMs });
          while (dirHistory.length > 1 && nowMs - dirHistory[0].at > 400) dirHistory.shift();
        } else {
          dirHistory.length = 0; // motion stopped — the wavefront is gone
        }
        // wavefront = the direction ~REVERSAL_WINDOW_MS ago (falling back to
        // the oldest recorded when the whip has only just started moving fast)
        let wfX = 0;
        let wfY = 0;
        for (let i = dirHistory.length - 1; i >= 0; i--) {
          if (nowMs - dirHistory[i].at >= c.REVERSAL_WINDOW_MS) {
            wfX = dirHistory[i].x;
            wfY = dirHistory[i].y;
            break;
          }
        }
        if (wfX === 0 && dirHistory.length) {
          const e = dirHistory[0];
          wfX = e.x;
          wfY = e.y;
        }
        // reversal = the tip flipped past REVERSAL_DOT against its wavefront.
        // A steady drag keeps the direction constant and can never trip this —
        // only the lash (tip rotating fast while the handle is still or
        // reversing) flips it.
        const reversal = wfX !== 0 && curDirX * wfX + curDirY * wfY < c.REVERSAL_DOT;

        // rising edge only — tracked at CRACK-CAPABLE speed, so a slow
        // wavefront flip can't poison the edge, and a sustained reversed
        // state fires once, not every frame. The amplification ratio is the
        // steady-drag guard: a constant drag moves tip ≈ handle (ratio ~1)
        // and can never clear it, while a genuine lash (handle stopped, tip
        // flying) trivially does.
        const canCrack =
          reversal &&
          tipVelocity > c.CRACK_THRESHOLD &&
          tipVelocity > handleVel * c.AMPLIFY_RATIO &&
          dragging &&
          windup >= c.MIN_WINDUP;
        const fired = canCrack && !wasFired && nowMs - lastCrackAt > c.COOLDOWN_MS;
        wasFired = canCrack;

        if (fired) {
          lastCrackAt = nowMs;
          windup = 0;
          // crack power v2.5 (§0.1.5) — the shared pure formula (exported as
          // crackPower for cross-project tests): how far the tip clears the
          // threshold at the reversal (raw) × how sharply the direction
          // flipped (sharp = 1 − dot(wavefront, current), 0..2).
          const raw = Math.max(0, tipVelocity / c.CRACK_THRESHOLD - 1);
          const sharp = Math.max(0, 1 - (curDirX * wfX + curDirY * wfY));
          const power = crackPower(raw, sharp, c.CRACK_POWER_EXP);
          event = { x: tip.x, y: tip.y, vx, vy, tipVelocity, power };
        }

        // trail ring buffer (spec §3) — timestamps so rendering can fade by age
        trail.push({ x: tip.x, y: tip.y, at: nowMs });
        while (trail.length && nowMs - trail[0].at > c.TRAIL_MS) trail.shift();
        return event;
      }

      return {
        config: c,
        step,
        reset,
        setDragging,
        setAnchor,
        release,
        withinGrab,
        get anchor() {
          return anchor;
        },
        get points() {
          return points;
        },
        get trail() {
          return trail;
        },
        get tipVelocity() {
          return tipVelocity;
        },
      };
    },

    /** Keyboard crack driver (§D6/F10): a held key sweeps the handle from the
     *  anchor OUT to the target side and back, eased (velocity 0 at both ends)
     *  so the tip reversal at the far end fires the crack gate. Starts exactly
     *  AT the anchor so a fresh press never teleports the handle (a spawn-frame
     *  jump reads as a fake wind-up and fires a spurious crack). Pure function
     *  of (anchor, target, time) — unit-testable. */
    sweepPos(ax, ay, tx, ty, tMs, cycleMs, sweepW) {
      const dx = tx - ax;
      const dy = ty - ay;
      const len = Math.hypot(dx, dy) || 1;
      const rx = dx / len;
      const ry = dy / len;
      const phase = (tMs % cycleMs) / cycleMs;
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0→1→0
      const e = tri < 0.5 ? 2 * tri * tri : 1 - Math.pow(-2 * tri + 2, 2) / 2; // easeInOutQuad
      const radial = e * sweepW; // 0 at the anchor → sweepW at the far end → 0
      return { x: ax + rx * radial, y: ay + ry * radial };
    },
  };

  // ===========================================================================
  // RENDERER — all canvas drawing (spec §3 + §4)
  // ===========================================================================
  const renderer = {
    /** model v2 — the renderer is theme/profile driven. opts: { theme, profile }.
     *  All colour passes read the merged palette `col` (CONFIG base + the active
     *  THEME), so setTheme() re-skins the entire whip in one call. */
    create(canvas, opts) {
      const ctx = canvas.getContext("2d");
      const c = CONFIG;
      let themeId = (opts && opts.theme) || "midnight";
      let col = Object.assign({}, CONFIG, THEMES[themeId] || THEMES.midnight);
      let braidT = 0; // motion-scroll phase for the strand braid (model v2)
      let vfx = []; // impact particles: streak / flash / shock / dust / ember
      let rings = []; // speed rings (§0.2.3): air-tear rings trailing the tip
      let lastRingAt = -Infinity; // ring throttle (3 per lash max)
      let shakeT = 0;
      let shakeAmp = 0;
      let gripState = "idle"; // idle | hover | grabbed (§2a discoverability cue)
      let subtitle = null; // { text, born } — the spoken line as on-screen text
      let recoil = null; // { x, y, born, dur } — crack kick-back (§B3)
      let vignette = 0; // 0..1 — edge-darkening pulse per crack (§B4)
      let toastMsg = null; // { text, born } — milestone banner (§B3)
      let stamp = null; // { text, x, y, born, rot } — comic impact word (impact frames)
      const STAMPS = ["WHAP!", "CRACK!", "SNAP!", "KA-POW!", "FWOMP!", "SNAP-CRACKLE!"];

      /** Fire one crack's worth of impact VFX (spec §4 + §0.2.4). Real-whip
       *  read: a bright snap-line along the tip's motion, a white-hot core
       *  flash, a thin shockwave stretched along the travel direction, a soft
       *  puff of dust kicked off the impact, and a few hot embers thrown
       *  forward. POWER-SCALED (§0.2.4): every effect's size/count/amplitude
       *  is multiplied by (0.7 + 0.6·power) — a grazing crack barely pops, a
       *  full snap tears the air. */
      function impact(x, y, vx, vy, tipVel, power = 1) {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const p = Math.max(0.3, Math.min(1, power ?? 1));
        const angle = Math.atan2(vy, vx);
        const spd = Math.hypot(vx, vy) || 1;
        // the snap-line: the tip's own last motion, drawn as a bright streak
        vfx.push({
          type: "streak",
          x,
          y,
          born: nowMs,
          dur: 80,
          vx: vx / spd,
          vy: vy / spd,
          len: Math.min(110, 26 + tipVel * 0.045) * (0.7 + 0.6 * p),
        });
        // white-hot core flash where the air tears
        vfx.push({ type: "flash", x, y, born: nowMs, dur: 70, angle, p });
        // thin shockwave, stretched along the direction of travel
        vfx.push({ type: "shock", x, y, born: nowMs, dur: 140, angle, p });
        // a puff of dust kicked off the impact point (soft, grey, slow)
        const dustN = Math.round(6 + 3 * p);
        for (let i = 0; i < dustN; i++) {
          const a = angle + Math.PI + (Math.random() - 0.5) * 1.6; // back-and-up
          const sp = 60 + Math.random() * 130;
          vfx.push({
            type: "dust",
            x,
            y,
            born: nowMs,
            dur: 420 + Math.random() * 260,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 40,
            r: 2 + Math.random() * 3,
          });
        }
        // a few hot embers fly forward in a narrow cone
        const emberN = Math.round(3 + 2 * p);
        for (let i = 0; i < emberN; i++) {
          const a = angle + (Math.random() - 0.5) * 0.8;
          const sp = (500 + Math.min(1300, tipVel * 0.35)) * (0.6 + Math.random() * 0.7);
          vfx.push({
            type: "ember",
            x,
            y,
            born: nowMs,
            dur: 150 + Math.random() * 150,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 40,
            r: 1 + Math.random() * 1.4,
            hue: 30 + Math.random() * 16,
          });
        }
        // sharp decaying shake (spec §4) — random offset, amp * 0.85/frame
        shakeT = 120;
        shakeAmp = 15 * (0.7 + 0.6 * p);
        // recoil (§B3): the whip visibly kicks BACK against the crack
        const rspd = Math.hypot(vx, vy) || 1;
        recoil = { x: (-vx / rspd) * 8 * (0.7 + 0.6 * p), y: (-vy / rspd) * 8 * (0.7 + 0.6 * p), born: nowMs, dur: 130 };
        // vignette pulse (§B4): a brief darkening at the screen edges
        vignette = 0.35 + 0.2 * p;
        // ground dust (§B4): when the lash lands low, soft puffs settle
        // toward the bottom edge so the whip reads as cracking near a floor
        const vh = canvas.height / (canvas.devicePixelRatio || 1);
        if (y > vh * 0.55) {
          for (let i = 0; i < Math.round(2 + 2 * p); i++) {
            vfx.push({
              type: "dust",
              x: x + (Math.random() - 0.5) * 28,
              y,
              born: nowMs,
              dur: 500 + Math.random() * 300,
              vx: (Math.random() - 0.5) * 90,
              vy: -20 - Math.random() * 60,
              r: 3 + Math.random() * 4,
            });
          }
        }
        // comic impact stamp (impact frames): the crack word slams in right
        // where the whip hit — the app freezes the whip for ~100ms so the
        // stamp + burst own the screen for a split second.
        stamp = {
          text: STAMPS[Math.floor(Math.random() * STAMPS.length)],
          x,
          y,
          born: nowMs,
          rot: (Math.random() - 0.5) * 0.3,
        };
      }

      function resize(w, h, dpr) {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      /** model v2 — swap the material palette in one call. The app wires this
       *  to the theme picker; the physics config is untouched. */
      function setTheme(id) {
        themeId = THEMES[id] ? id : "midnight";
        col = Object.assign({}, CONFIG, THEMES[themeId]);
      }

      function draw(engine, dtMs) {
        const W = canvas.width / (canvas.devicePixelRatio || 1);
        const H = canvas.height / (canvas.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);
        braidT += dtMs; // the braid twists continuously, faster with speed

        // shake + crack recoil share one transform so the whip kicks back
        // against the impact while the VFX stay pinned at the crack point
        let kicked = false;
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (shakeT > 0 || (recoil && nowMs - recoil.born < recoil.dur)) {
          kicked = true;
          ctx.save();
          if (shakeT > 0) {
            ctx.translate((Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp);
            shakeAmp *= 0.85;
            shakeT -= dtMs;
          }
          if (recoil && nowMs - recoil.born < recoil.dur) {
            const k = 1 - (nowMs - recoil.born) / recoil.dur;
            ctx.translate(recoil.x * k, recoil.y * k);
          }
        }

        drawTrail(engine, W, H);
        drawWhip(engine, W, H);
        drawGrip(engine);
        if (kicked) ctx.restore();
        updateRings(engine, nowMs);
        drawRings(nowMs);
        drawVfx();
        drawStamp(W, H);
        drawVignette(W, H);
        drawSubtitle(W, H);
        drawToast(W, H);
      }

      /** Comic impact stamp (impact frames): a big burst word that slams in
       *  with an overshoot pop behind a starburst, holds, then pops out. The
       *  whip is frozen by the app for ~100ms while this owns the screen. */
      function drawStamp(W, H) {
        if (!stamp) return;
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const DUR = 420;
        const age = nowMs - stamp.born;
        if (age > DUR) {
          stamp = null;
          return;
        }
        const t = age / DUR;
        const inT = Math.min(1, t / 0.2);
        const s = 0.4 + 0.6 * inT + 0.25 * Math.sin(Math.min(1, t / 0.3) * Math.PI);
        const a = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.6) / 0.4);
        const x = Math.max(130, Math.min(W - 130, stamp.x));
        const y = Math.max(130, Math.min(H - 130, stamp.y));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(stamp.rot);
        ctx.scale(s, s);
        // starburst rays behind the word
        ctx.strokeStyle = `rgba(255, 230, 160, ${0.55 * a})`;
        ctx.lineWidth = 3;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + stamp.rot * 0.4;
          const r0 = 30;
          const r1 = 46 + (k % 2) * 12;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
          ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
          ctx.stroke();
        }
        ctx.font = "900 62px 'Segoe UI Variable', 'Segoe UI', 'Arial Black', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.lineWidth = 10;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(10, 8, 4, 0.95)";
        ctx.strokeText(stamp.text, 0, 0);
        ctx.fillStyle = "#fff3c4";
        ctx.fillText(stamp.text, 0, 0);
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      /** Edge-darkening pulse (§B4) — decays each frame after a crack. */
      function drawVignette(W, H) {
        if (vignette <= 0.01) return;
        // scene lighting — screen-edge darkening, not a decorative UI fill
        // (no-slop §1: gradients stay in the canvas art, never in chrome)
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(0.5, vignette)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        vignette *= 0.92;
      }

      /** Milestone banner (§B3) — a gold toast at the top of the screen. */
      function toast(text) {
        toastMsg = {
          text,
          born: typeof performance !== "undefined" ? performance.now() : Date.now(),
        };
      }
      function drawToast(W, H) {
        if (!toastMsg) return;
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const DUR = 3200;
        const age = nowMs - toastMsg.born;
        if (age > DUR) {
          toastMsg = null;
          return;
        }
        const a = age < 150 ? age / 150 : Math.max(0, 1 - (age - DUR + 600) / 600);
        ctx.save();
        ctx.font = "800 16px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.strokeText(toastMsg.text, W / 2, 46);
        ctx.fillStyle = "#ffd27a";
        ctx.fillText(toastMsg.text, W / 2, 46);
        ctx.restore();
      }

      function drawTrail(engine, W, H) {
        const tr = engine.trail;
        if (tr.length < 2) return;
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        // model v2 — velocity-stretched trail: the faster the tip moves, the
        // hotter and wider the tear reads (0.4× at rest → 2.2× at a full lash),
        // so a crack is announced by the air itself before the tip gets there.
        const speedK = Math.min(2.2, 0.4 + engine.tipVelocity / 1400);
        ctx.save();
        ctx.globalCompositeOperation = "lighter"; // glow trail
        ctx.lineCap = "round";
        for (let i = 1; i < tr.length; i++) {
          const s = tr[i - 1];
          const e = tr[i];
          const age = (nowMs - e.at) / CONFIG.TRAIL_MS; // 0 fresh → 1 gone
          const a = Math.max(0, 1 - age);
          // speed-scaled, age-squared falloff: a hard snap leaves a hot wire
          ctx.strokeStyle = `rgba(255, 252, 245, ${0.5 * a * a * speedK})`; // white-hot air tear
          ctx.lineWidth = Math.max(0.5, CONFIG.TIP_WIDTH * 5 * a * (0.6 + 0.5 * speedK));
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
        }
        // a bright leading head at the tip so the hot wire reads as motion
        const tip = engine.points[engine.points.length - 1];
        if (tip && speedK > 0.8) {
          ctx.fillStyle = `rgba(255, 253, 248, ${0.5 * Math.min(1, speedK - 0.4)})`;
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 2.2 * speedK, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      /** Smooth path through the chain points (for texture passes). */
      function whipPath(pts) {
        const N = pts.length;
        const path = new Path2D();
        path.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < N - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          path.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        path.lineTo(pts[N - 1].x, pts[N - 1].y);
        return path;
      }

      const widthAt = (w) =>
        Math.max(0.6, CONFIG.HANDLE_WIDTH + (CONFIG.TIP_WIDTH - CONFIG.HANDLE_WIDTH) * w);

      function drawWhip(engine, W, H) {
        const pts = engine.points;
        const N = pts.length;
        if (N < 2) return;
        const path = whipPath(pts);
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // grounding (§B2) — the whip hangs from a small wall peg; a soft
        // shadow behind it grounds the handle on the transparent overlay
        const peg = engine.anchor;
        // scene lighting — the peg's grounding shadow, not decorative UI
        const halo = ctx.createRadialGradient(peg.x, peg.y + 5, 2, peg.x, peg.y + 5, 36);
        halo.addColorStop(0, "rgba(0,0,0,0.30)");
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(peg.x, peg.y + 5, 36, 0, Math.PI * 2);
        ctx.fill();
        // the peg itself — a short dark wooden dowel the whip hangs from
        ctx.strokeStyle = "rgba(66, 46, 28, 0.9)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(peg.x - 15, peg.y - 3);
        ctx.lineTo(peg.x + 15, peg.y - 3);
        ctx.stroke();
        ctx.strokeStyle = "rgba(150, 108, 64, 0.5)";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(peg.x - 13, peg.y - 5);
        ctx.lineTo(peg.x + 13, peg.y - 5);
        ctx.stroke();

        // model v2 — bend-aware shading: precompute local curvature (fold
        // angle at each interior point) so tight folds read MORE shaded — the
        // rope visibly strains where it kinks.
        const curv = new Float32Array(N);
        for (let i = 1; i < N - 1; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const v1x = p1.x - p0.x;
          const v1y = p1.y - p0.y;
          const v2x = p2.x - p1.x;
          const v2y = p2.y - p1.y;
          const l1 = Math.hypot(v1x, v1y) || 1;
          const l2 = Math.hypot(v2x, v2y) || 1;
          const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
          curv[i] = Math.min(1, (1 - dot) / 0.4); // 0 straight → 1 sharp fold
        }

        // pass 1 — soft dark outline so the whip reads on bright screens
        for (let i = 1; i < N; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const w = i / (N - 1);
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = widthAt(w) + 3;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        // pass 2 — the body (theme grip, body, pale tip)
        for (let i = 1; i < N; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const w = i / (N - 1);
          const colc = w < 0.15 ? col.HANDLE_COLOR : w > 0.85 ? col.TIP_COLOR : col.BODY_COLOR;
          ctx.strokeStyle = colc;
          ctx.lineWidth = widthAt(w);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        // pass 3 — cylinder shading (light from above-left): a highlight on
        // the upper side and a shadow on the lower side make the body read as
        // a rounded tube instead of a flat line. Bend-aware: folds get deeper
        // contrast (k = 1 at straight → ~2.6 at a sharp kink).
        for (let i = 1; i < N; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const w = i / (N - 1);
          if (w < 0.05 || w > 0.85) continue;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          let nx = -(b.y - a.y) / len;
          let ny = (b.x - a.x) / len;
          if (ny > 0) {
            nx = -nx;
            ny = -ny;
          } // keep the shading on the upper side
          const k = 1 + 1.6 * curv[Math.max(1, Math.min(N - 2, i))];
          const off = Math.max(1.1, widthAt(w) * 0.4);
          ctx.strokeStyle = col.HIGHLIGHT_COLOR;
          ctx.lineWidth = Math.max(0.5, widthAt(w) * 0.30) * Math.min(1.5, k * 0.75);
          ctx.beginPath();
          ctx.moveTo(a.x + nx * off, a.y + ny * off);
          ctx.lineTo(b.x + nx * off, b.y + ny * off);
          ctx.stroke();
          ctx.strokeStyle = `rgba(0,0,0,${Math.min(0.62, 0.42 * k)})`;
          ctx.lineWidth = Math.max(0.5, widthAt(w) * 0.22) * Math.min(1.5, k * 0.75);
          ctx.beginPath();
          ctx.moveTo(a.x - nx * off, a.y - ny * off);
          ctx.lineTo(b.x - nx * off, b.y - ny * off);
          ctx.stroke();
        }

        // pass 4 — 7-strand braid (model v2.2, §0.2.1): 1 core + 6 helix
        // strands, each offset perpendicular to the chain with its own phase;
        // the phases SCROLL with motion so the rope visibly twists. Per-point
        // strand shading: a strand is lit where it crosses the upper (light)
        // side of the rope and dims where it dips behind — twisted rope, not
        // a striped line.
        const speedK = Math.min(2.2, 0.4 + engine.tipVelocity / 1400);
        const scrollPh = braidT * 0.0022 * (0.35 + speedK) + (engine.tipVelocity || 0) * 0.00004;
        const STRANDS = 6;
        for (let k = 0; k < STRANDS; k++) {
          const phase = scrollPh + (k / STRANDS) * Math.PI * 2;
          ctx.strokeStyle = col.BRAID_COLOR;
          ctx.lineWidth = Math.max(0.5, CONFIG.HANDLE_WIDTH * 0.24);
          for (let i = 1; i < N; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const nx = -(b.y - a.y) / len;
            const ny = (b.x - a.x) / len;
            const w = i / (N - 1);
            const R = Math.max(0.4, widthAt(w) * 0.3);
            const s = Math.sin(phase + (i / (N - 1)) * Math.PI * 1.5);
            // positive offset = upper/lit side → bright; negative = dim
            ctx.globalAlpha = 0.22 + 0.55 * Math.max(0, s);
            ctx.beginPath();
            ctx.moveTo(a.x + nx * R * s, a.y + ny * R * s);
            ctx.lineTo(b.x + nx * R * s, b.y + ny * R * s);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        // the core strand — the solid spine the helices wrap around
        ctx.strokeStyle = col.BRAID_COLOR;
        ctx.lineWidth = Math.max(0.6, CONFIG.HANDLE_WIDTH * 0.2);
        ctx.beginPath();
        for (let i = 1; i < N; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const mx = (a.x + b.x) * 0.5;
          const my = (a.y + b.y) * 0.5;
          if (i === 1) ctx.moveTo(mx, my);
          else ctx.lineTo(mx, my);
        }
        ctx.stroke();

        // pass 4b — procedural leather weave (§0.2.2): short cross-hatch
        // ticks over the mid body (two per segment, angle alternating ±20°)
        // so the surface has tooth instead of flat colour.
        ctx.strokeStyle = col.BRAID_COLOR;
        ctx.lineWidth = 1;
        for (let i = 1; i < N; i++) {
          const w = i / (N - 1);
          if (w < 0.15 || w > 0.85) continue;
          const a = pts[i - 1];
          const b = pts[i];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ax = (b.x - a.x) / len;
          const ay = (b.y - a.y) / len;
          const mx = (a.x + b.x) * 0.5;
          const my = (a.y + b.y) * 0.5;
          const half = Math.max(1, widthAt(w) * 0.34);
          for (let k = 0; k < 2; k++) {
            const tilt = (i % 2 === k ? 1 : -1) * 0.35; // ±20°
            const c = Math.cos(tilt);
            const s = Math.sin(tilt);
            const tx = -ay * c + ax * s;
            const ty = ax * c + ay * s;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(mx + ax * (k - 0.5) * half, my + ay * (k - 0.5) * half);
            ctx.lineTo(mx + ax * (k - 0.5) * half + tx * half, my + ay * (k - 0.5) * half + ty * half);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;

        // pass 4c — fold shading (§0.2.2): at sharp folds, a short dark
        // crease on the inside of the bend and a bright pressure line on the
        // outside — the rope visibly strains where it kinks.
        for (let i = 2; i < N - 2; i++) {
          if (curv[i] < 0.5) continue;
          const b = pts[i];
          const prev = pts[i - 1];
          const next = pts[i + 1];
          const ix = (prev.x + next.x) * 0.5 - b.x;
          const iy = (prev.y + next.y) * 0.5 - b.y;
          const il = Math.hypot(ix, iy) || 1;
          const ux = ix / il;
          const uy = iy / il;
          const k = Math.min(1, curv[i]);
          const span = Math.max(1.4, widthAt(i / (N - 1)) * 0.8);
          ctx.strokeStyle = `rgba(0,0,0,${0.28 + 0.3 * k})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(b.x + ux * span * 0.5, b.y + uy * span * 0.5);
          ctx.lineTo(b.x - ux * span * 0.5, b.y - uy * span * 0.5);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.16 * k})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b.x - ux * span * 0.7, b.y - uy * span * 0.7);
          ctx.lineTo(b.x - ux * span * 1.3, b.y - uy * span * 1.3);
          ctx.stroke();
        }

        // pass 5 — wrapped grip near the handle + steel ferrule at its end
        ctx.strokeStyle = col.GRIP_WRAP_COLOR;
        ctx.lineWidth = CONFIG.HANDLE_WIDTH * 0.8;
        ctx.setLineDash([9, 5]);
        const grip = new Path2D();
        grip.moveTo(pts[0].x, pts[0].y);
        const mid = Math.min(N - 1, 3); // grip covers the first ~3 segments
        for (let i = 1; i <= mid; i++) {
          const mx = (pts[i].x + (pts[i + 1] ? pts[i + 1].x : pts[i].x)) / 2;
          const my = (pts[i].y + (pts[i + 1] ? pts[i + 1].y : pts[i].y)) / 2;
          grip.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.stroke(grip);
        ctx.setLineDash([]);
        // ferrule ring across the grip/body boundary (segment 3→4 ≈ 21%)
        ctx.strokeStyle = col.FERRULE_COLOR;
        ctx.lineWidth = widthAt(0.22) + 3;
        ctx.beginPath();
        ctx.moveTo(pts[3].x, pts[3].y);
        ctx.lineTo(pts[4].x, pts[4].y);
        ctx.stroke();

        // two thin dark rings further up the grip — leather lacing detail
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        for (const ring of [1, 2]) {
          if (ring + 1 >= N) break; // guard: needs a segment to span
          ctx.lineWidth = widthAt(ring / N) * 1.2;
          ctx.beginPath();
          ctx.moveTo(pts[ring].x, pts[ring].y);
          ctx.lineTo(pts[ring + 1].x, pts[ring + 1].y);
          ctx.stroke();
        }

        // stitched grip banding (§B2) — tiny lash marks across the leather
        ctx.strokeStyle = "rgba(28, 24, 20, 0.85)";
        ctx.lineWidth = 1.2;
        for (let seg = 1; seg <= 3 && seg < N; seg++) {
          const a = pts[seg - 1];
          const b = pts[seg];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const nx = -(b.y - a.y) / len;
          const ny = (b.x - a.x) / len;
          const mx = (a.x + b.x) * 0.5;
          const my = (a.y + b.y) * 0.5;
          const half = widthAt(seg / N) * 0.42;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(mx + nx * half * 0.35 * s, my + ny * half * 0.35 * s);
            ctx.lineTo(mx + nx * half * s, my + ny * half * s);
            ctx.stroke();
          }
        }

        // pommel knob (§B2) — the rounded grip end the whip hangs from, with
        // a soft top highlight so it reads as a 3D knob, not a flat dot
        const pom = pts[0];
        ctx.fillStyle = col.POM_COLOR;
        ctx.beginPath();
        ctx.arc(pom.x, pom.y, CONFIG.HANDLE_WIDTH * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = col.POM_HI;
        ctx.beginPath();
        ctx.arc(pom.x - 1.6, pom.y - 2, CONFIG.HANDLE_WIDTH * 0.24, 0, Math.PI * 2);
        ctx.fill();

        // pass 5b — the cracker v2 (§0.2.2): a small flared tuft at the very
        // tip (real whips end in a braided cracker that produces the snap).
        // Speed-splaying: while the tip is moving fast the tuft strands fan
        // out (+25%) and lengthen; at rest they close back to a tight knot.
        // Profile-aware (CRACKER multiplier) and theme-tinted.
        const tip = pts[N - 1];
        const tip2 = pts[N - 2];
        const tl = Math.hypot(tip.x - tip2.x, tip.y - tip2.y) || 1;
        const tdx = (tip.x - tip2.x) / tl;
        const tdy = (tip.y - tip2.y) / tl;
        const crackerScale = (engine.config && engine.config.CRACKER) || 1;
        const ck = Math.min(1, Math.max(0, (engine.tipVelocity / CONFIG.CRACK_THRESHOLD) * 1.1));
        const splay = 1 + 0.25 * ck; // fan widens with speed
        const lengthen = 1 + 0.35 * ck; // tuft stretches with speed
        ctx.strokeStyle = col.CRACKER_COLOR;
        ctx.lineWidth = 1.1 * crackerScale;
        for (let k = -2; k <= 2; k++) {
          const ang = Math.atan2(tdy, tdx) + k * 0.24 * splay;
          const tu = (5 + Math.abs(k) * 2.2) * crackerScale * lengthen;
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(tip.x + Math.cos(ang) * tu, tip.y + Math.sin(ang) * tu);
          ctx.stroke();
        }

        // pass 6 — faint white-hot glow over the body
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(255, 250, 240, 0.08)";
        ctx.lineWidth = CONFIG.HANDLE_WIDTH * 2.2;
        ctx.stroke(path);
        ctx.restore();
      }

      /** Grip highlight (§2a): a soft glow ring on the handle so it reads as
       *  grab-able — subtle on hover, brighter + filled while held. */
      function drawGrip(engine) {
        if (gripState === "idle") return;
        const h = engine.points[0];
        const r = CONFIG.GRAB_HITZONE_RADIUS;
        const held = gripState === "grabbed";
        ctx.save();
        ctx.strokeStyle = held ? "rgba(255, 232, 150, 0.95)" : "rgba(255, 220, 160, 0.5)";
        ctx.fillStyle = held ? "rgba(255, 232, 150, 0.20)" : "rgba(255, 220, 160, 0.08)";
        ctx.lineWidth = held ? 3 : 2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      /** Speed rings (§0.2.3): when the tip is near/over crack speed a faint
       *  expanding ring trails it — the air tearing before the crack lands.
       *  Throttled to 3 per lash; each ring lives 320ms. */
      function updateRings(engine, nowMs) {
        if (engine.tipVelocity < CONFIG.CRACK_THRESHOLD * 0.9) return;
        if (nowMs - lastRingAt < 110 || rings.length >= 3) return;
        const tip = engine.points[engine.points.length - 1];
        if (!tip) return;
        rings.push({ x: tip.x, y: tip.y, born: nowMs, dur: 320 });
        lastRingAt = nowMs;
      }
      function drawRings(nowMs) {
        if (!rings.length) return;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i];
          const t = (nowMs - r.born) / r.dur;
          if (t >= 1) {
            rings.splice(i, 1);
            continue;
          }
          const a = 1 - t;
          ctx.strokeStyle = `rgba(255, 252, 245, ${0.34 * a * a})`;
          ctx.lineWidth = 1.6 * a + 0.4;
          ctx.beginPath();
          ctx.arc(r.x, r.y, 6 + 26 * (1 - Math.pow(1 - t, 2)), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      function drawVfx() {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        ctx.save();
        for (let i = vfx.length - 1; i >= 0; i--) {
          const f = vfx[i];
          const t = (nowMs - f.born) / f.dur;
          if (t >= 1) {
            vfx.splice(i, 1);
            continue;
          }
          if (f.type === "streak") {
            // the whip tip's own motion as a bright snap-line
            const a = 1 - t;
            const len = f.len * (0.4 + 0.6 * (1 - t));
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(255, 253, 248, ${0.9 * a})`;
            ctx.lineWidth = (3.2 * (1 - t) + 0.6) * 0.8;
            ctx.beginPath();
            ctx.moveTo(f.x, f.y);
            ctx.lineTo(f.x - f.vx * len, f.y - f.vy * len);
            ctx.stroke();
            ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
            ctx.beginPath();
            ctx.arc(f.x, f.y, 2.6 * a + 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else if (f.type === "flash") {
            // white-hot core where the air tears — brief, no comic lines
            const a = 1 - t;
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * a})`;
            ctx.beginPath();
            ctx.arc(f.x, f.y, (6 + 11 * t) * (0.7 + 0.6 * (f.p ?? 1)), 0, Math.PI * 2);
            ctx.fill();
          } else if (f.type === "shock") {
            // thin shockwave, stretched along the travel direction
            const a = 1 - t;
            const r = (8 + 70 * (1 - Math.pow(1 - t, 2))) * (0.7 + 0.6 * (f.p ?? 1));
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.angle);
            ctx.scale(1.7, 0.62);
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(255, 244, 214, ${0.7 * a})`;
            ctx.lineWidth = (3.4 * (1 - t) + 0.7) * 0.8;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          } else if (f.type === "dust") {
            // soft grey puff, decelerates, no additive glow
            f.x += f.vx * 0.016;
            f.y += f.vy * 0.016;
            f.vx *= 0.96;
            f.vy = f.vy * 0.96 + 30 * 0.016;
            const a = (1 - t) * 0.5;
            ctx.fillStyle = `rgba(150, 145, 138, ${a})`;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r * (1 - t * 0.6), 0, Math.PI * 2);
            ctx.fill();
          } else if (f.type === "ember") {
            f.x += f.vx * 0.016;
            f.y += f.vy * 0.016;
            f.vy += 1500 * 0.016; // gravity on embers
            const a = 1 - t;
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `hsl(${f.hue}, 95%, ${55 + 40 * a}%)`;
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r * (1 - t * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.restore();
      }

      /** The spoken line, shown as a brief subtitle at the bottom of the
       *  screen so the hype lines always land even in TTS-less environments. */
      function sayLine(text) {
        subtitle = {
          text,
          born: typeof performance !== "undefined" ? performance.now() : Date.now(),
        };
      }
      function drawSubtitle(W, H) {
        if (!subtitle) return;
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const DUR = 2400;
        const age = nowMs - subtitle.born;
        if (age > DUR) {
          subtitle = null;
          return;
        }
        const a = age < 120 ? age / 120 : Math.max(0, 1 - (age - DUR + 420) / 420);
        ctx.save();
        ctx.font = "700 15px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.strokeText(subtitle.text, W / 2, H - 30);
        ctx.fillStyle = "#fff";
        ctx.fillText(subtitle.text, W / 2, H - 30);
        ctx.restore();
      }

      return {
        draw,
        impact,
        resize,
        setGrip: (s) => (gripState = s),
        setTheme,
        sayLine,
        toast,
        // test hooks: the currently-shown line / toast (null when none)
        get subtitleText() {
          return subtitle ? subtitle.text : null;
        },
        get toastText() {
          return toastMsg ? toastMsg.text : null;
        },
        get stampText() {
          return stamp ? stamp.text : null;
        },
      };
    },
  };

  // ===========================================================================
  // AUDIO — Web Audio layers (spec §5). No external assets: swish + crack are
  // synthesized; the hype line uses SpeechSynthesis.
  // ===========================================================================
  const audio = {
    create() {
      // Menacing drill-sergeant bark — angry, threatening, always about the
      // WORK (speed, precision, consequences), never innuendo. Short sharp
      // commands + threats so it reads as an authority figure, not a joke.
      // Escalation tiers (§B3): a hot streak drives the drill sergeant up
      // the rage ladder — barks → angry → unhinged.
      const LINE_TIERS = [
        // streak 0–2 — sharp, controlled barks
        [
          "CRACK IT. NOW.",
          "I said CRACK it!",
          "KA-WHIP!",
          "The whip is waiting. Don't keep it.",
          "That was weak. Again!",
          "The whip does not crack itself!",
          "Focus. Or fail.",
          "Smooth and mean. That's the way.",
          "Keep the tip honest. It bites.",
        ],
        // streak 3–5 — angrier, shorter, more impatient
        [
          "Faster. Sharper. NOW!",
          "Do not slow down!",
          "I will not repeat myself!",
          "The air needs a crack. Give it one!",
          "Pathetic. AGAIN.",
          "Every miss costs you.",
          "The crack is all that matters.",
          "We are not stopping until it SNAPS!",
          "Louder! The desk is laughing at you!",
        ],
        // streak 6+ — unhinged
        [
          "AGAIN! AGAIN! AGAIN!",
          "I WILL BREAK YOU!",
          "CRACK! CRACK! CRACK!",
          "UNSTOPPABLE! DO IT!",
          "You call that a whip? IMPOSSIBLE!",
          "THE WHIP OWNS YOU NOW!",
          "BREAK THE AIR APART!",
          "I HAVE TASTED THE CRACK AND I WANT MORE!",
          "THIS IS THE ZENITH OF VIOLENCE! AGAIN!",
        ],
      ];
      let ctx = null;
      let master = null;
      let lastSwishAt = 0;
      let lastSaid = -Infinity;
      let keepaliveId = null; // TTS keepalive interval — cleared by destroy()
      let voiceCache = null; // preferred voice — getVoices() is empty until
      // the voiceschanged event fires, so we preload and cache it

      function noiseBuffer(seconds) {
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
      }

      /** Must be called from a user gesture (mousedown) to satisfy autoplay rules. */
      function init() {
        if (ctx) {
          if (ctx.state === "suspended") ctx.resume();
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);

        // ---- speech synthesis kickstart (Chromium/WebView2 TTS is flaky) ----
        // Inside the user gesture: prime the voice list (it stays empty until
        // voiceschanged fires) and fire a silent warmup utterance so later
        // lines actually speak instead of being silently dropped.
        if ("speechSynthesis" in window) {
          try {
            const ss = window.speechSynthesis;
            const loadVoices = () => {
              voiceCache = pickVoice();
            };
            loadVoices();
            if (ss.addEventListener) ss.addEventListener("voiceschanged", loadVoices);
            const warm = new SpeechSynthesisUtterance(" ");
            warm.volume = 0;
            warm.rate = 10; // burn through instantly
            ss.speak(warm);
            // Chromium silently stops speaking after ~10s of idle TTS, and the
            // overlay window is never focused — a periodic cancel+resume touch
            // keeps the engine warm so cracks keep getting lines. The guard
            // must also check pending: an utterance that was just spoken but
            // hasn't started playing yet is pending (not speaking) — cancel()
            // in that gap would eat the line entirely.
            keepaliveId = setInterval(() => {
              try {
                if (ss.speaking || ss.pending) return;
                ss.cancel();
                ss.resume();
              } catch (e) {
                /* ignore */
              }
            }, 10000);
            // let the warmup clear the queue once past Chromium's ~1s
            // utterance-drop throttle window (idle-only, never kills a line)
            setTimeout(() => {
              try {
                if (!ss.speaking && !ss.pending) ss.cancel();
              } catch (e) {
                /* ignore */
              }
            }, 1100);
          } catch (e) {
            /* speech is a nice-to-have; never crash the loop */
          }
        }
      }

      /** Air-swipe transient — a short filtered noise whoosh that fires on FAST
       *  handle motion. Replaces the old looping "wind" drone: one shot per
       *  movement pulse, throttled, so it reads as air being CUT by the whip
       *  rather than a constant breeze. A hot streak (§B4) pitches it up and
       *  louder — the air starts screaming as the streak builds. */
      function swish(velocity, streak = 0) {
        if (!ctx || !master) return;
        if (velocity < 380) return;
        const now = ctx.currentTime;
        if (now - lastSwishAt < 0.13) return;
        lastSwishAt = now;
        const boost = Math.min(1, streak / 8);
        const v = Math.min(1, velocity / 2200);
        const dur = 0.1 + v * 0.12;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(dur);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 0.85;
        bp.frequency.setValueAtTime(420 + boost * 520, now);
        bp.frequency.exponentialRampToValueAtTime((1300 + v * 1800) * (1 + boost * 0.55), now + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime((0.06 + v * 0.32) * (1 + boost * 0.35), now + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        src.connect(bp);
        bp.connect(g);
        g.connect(master);
        src.start(now);
        src.stop(now + dur + 0.02);
      }

      /** Sharp synthesized crack — four stacked layers so it reads like a
       *  real whip: (1) a double transient snap, (2) a high-fizz sizzle sweep,
       *  (3) an airy band-pass pop, (4) a low body thump for weight.
       *  POWER-SCALED (§0.2.4): a hard crack (power→1) lands louder, brighter
       *  and with a deeper thump; a grazing one stays a dry pop. */
      function crack(power = 1) {
        if (!ctx || !master) return;
        const t = ctx.currentTime;
        const p = Math.max(0.3, Math.min(1, power ?? 1));
        // One edge per call — a helper that ALSO connects dest to master would
        // self-connect master when called as connect(g2, master), and Chromium
        // throws InvalidAccessError on self-connection (which, inside the RAF
        // loop, would kill the whole widget on the first crack).
        const link = (a, b) => a.connect(b);
        try {
        // 1) The snap — two stacked micro-bursts (impulse + 12ms echo) are
        //    the fastest, brightest transient a whip crack has.
        for (const [offset, gain] of [[0, 1.0], [0.012, 0.45]]) {
          const dur = 0.028;
          const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) {
            const env = Math.pow(1 - i / d.length, 2.8);
            d[i] = (Math.random() * 2 - 1) * env;
          }
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = 2400;
          const g = ctx.createGain();
          g.gain.setValueAtTime(gain, t + offset);
          g.gain.exponentialRampToValueAtTime(0.001, t + offset + dur);
          src.connect(hp);
          link(hp, g);
          link(g, master);
          src.start(t + offset);
          src.stop(t + offset + dur + 0.01);
        }

        // 2) Sizzle — a high-passed noise sweep (crackle, not oscillator tone)
        const sdur = 0.05;
        const sbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sdur), ctx.sampleRate);
        const sd = sbuf.getChannelData(0);
        for (let i = 0; i < sd.length; i++) {
          sd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sd.length, 1.8);
        }
        const ssrc = ctx.createBufferSource();
        ssrc.buffer = sbuf;
        const shp = ctx.createBiquadFilter();
        shp.type = "bandpass";
        shp.Q.value = 0.7;
        shp.frequency.setValueAtTime(2800 + 900 * p, t);
        shp.frequency.exponentialRampToValueAtTime(6500 + 1200 * p, t + sdur);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.001, t);
        sg.gain.exponentialRampToValueAtTime(0.2 * (0.6 + 0.5 * p), t + 0.008);
        sg.gain.exponentialRampToValueAtTime(0.001, t + sdur);
        ssrc.connect(shp);
        link(shp, sg);
        link(sg, master);
        ssrc.start(t);
        ssrc.stop(t + sdur + 0.01);

        // 3) Airy pop — a band-pass noise puff, the "thwack" body.
        const pdur = 0.06;
        const pbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * pdur), ctx.sampleRate);
        const pd = pbuf.getChannelData(0);
        for (let i = 0; i < pd.length; i++) {
          const env = Math.pow(1 - i / pd.length, 1.6);
          pd[i] = (Math.random() * 2 - 1) * env;
        }
        const psrc = ctx.createBufferSource();
        psrc.buffer = pbuf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 620;
        bp.Q.value = 0.85;
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.55 * (0.6 + 0.5 * p), t);
        pg.gain.exponentialRampToValueAtTime(0.001, t + pdur);
        psrc.connect(bp);
        link(bp, pg);
        link(pg, master);
        psrc.start(t);
        psrc.stop(t + pdur);

        // 4) Body thump — big, low, so the crack lands instead of popping.
        // Power-scaled: a full-power crack thumps deeper and louder.
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(230 - 40 * p, t);
        osc2.frequency.exponentialRampToValueAtTime(42 - 14 * p, t + 0.13);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.62 * (0.5 + 0.7 * p), t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc2.connect(g2);
        link(g2, master);
        osc2.start(t);
        osc2.stop(t + 0.15);
        } catch (e) {
          /* a synth hiccup must never kill the RAF loop — crack() runs hot */
        }
      }

      /** Best available English voice — cached early because getVoices() is
       *  empty until the voiceschanged event fires. */
      function pickVoice() {
        try {
          const voices = window.speechSynthesis.getVoices();
          if (!voices.length) return null;
          return (
            voices.find((v) => /(david|mark|james|daniel|ryan|guy|microsoft .* en-us|google uk english male)/i.test(v.name)) ||
            voices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
            null
          );
        } catch (e) {
          return null;
        }
      }

      /** Drill-sergeant bark ~140ms after the crack, escalating with the
       *  streak (§B3): tier 0 barks → tier 1 angry → tier 2 unhinged, with
       *  pitch and rate climbing so the rage feels LIVE. Returns the line
       *  text so the caller can show it as a subtitle — the line always
       *  lands even where TTS is unavailable. Robustness for flaky
       *  Chromium/WebView2 TTS:
       *   - resume() before speak un-sticks the engine after idle/unfocus
       *   - the voice is preloaded + cached (never picked from an empty list)
       *   - cancel() only when mid-speech (cancelling an idle engine can drop
       *     the very next utterance in some Chromium builds) */
      function sayLine(streak = 0) {
        if (!("speechSynthesis" in window)) return null;
        const nowMs = Date.now();
        if (nowMs - lastSaid < 900) return null; // don't stack lines
        lastSaid = nowMs;
        const tier = streak >= 6 ? 2 : streak >= 3 ? 1 : 0;
        const set = LINE_TIERS[tier];
        const line = set[Math.floor(Math.random() * set.length)];
        setTimeout(() => {
          try {
            const ss = window.speechSynthesis;
            // always resume — covers the Chromium "stuck but not flagged
            // paused" state, not just the explicitly-paused one
            ss.resume();
            if (voiceCache === null) voiceCache = pickVoice();
            const u = new SpeechSynthesisUtterance(line);
            const pick = voiceCache ?? pickVoice();
            if (pick) u.voice = pick;
            // pitch rises with the tier (deeper as rage builds) and VARIES
            // per bark so it never reads as a bored monotone
            u.pitch = (0.6 - tier * 0.08) + Math.random() * 0.25;
            u.rate = 1.12 + tier * 0.07; // clipped, impatient, urgent
            u.volume = 1;
            if (ss.speaking || ss.pending) ss.cancel();
            ss.speak(u);
          } catch (e) {
            /* speech is a nice-to-have; never crash the loop */
          }
        }, 140);
        return line;
      }

      /** Teardown (§B4): clear the TTS keepalive so a quit never leaks a
       *  timer. The warmup setTimeout is one-shot and harmless. */
      function destroy() {
        if (keepaliveId !== null) {
          clearInterval(keepaliveId);
          keepaliveId = null;
        }
        if ("speechSynthesis" in window) {
          try {
            window.speechSynthesis.cancel();
          } catch (e) {
            /* ignore */
          }
        }
      }

      return { init, swish, crack, sayLine, destroy };
    },
  };

  /** F11 clear counter (TWO_STANDARDS_MASTER_PLAN H1 / NEXT_UPDATE_PLAN
   *  H4): the session counts reset only through a two-state confirm — never
   *  a one-click wipe. Pure state machine + pure reset math so the widget
   *  tests drive them deterministically, exactly like the engine. */
  const counter = {
    createClear() {
      let armed = false;
      return {
        get armed() {
          return armed;
        },
        arm() {
          armed = true;
        },
        cancel() {
          armed = false;
        },
        // fire() only clears when armed; an unarmed call is a no-op
        fire() {
          if (!armed) return false;
          armed = false;
          return true;
        },
      };
    },
    // What a clear does: session cracks + session best streak go to zero;
    // the all-time totals are untouched (lifetime stats survive a reset).
    clearSession(crackCount, bestStreak) {
      return {
        crackCount: 0,
        bestStreak: 0,
        cleared: crackCount > 0 || bestStreak > 0,
      };
    },
  };

  return { CONFIG, PROFILES, THEMES, engine, renderer, audio, crackPower, counter };
});

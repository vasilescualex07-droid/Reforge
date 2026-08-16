/*
 * Whip Cracker — widget-context app wiring (ported from the standalone Whip
 * Cracker project, spec §4).
 *
 * The simulation (`whip-sim.js`) is reused verbatim; this file re-wires the
 * standalone app's overlay mode for the Reforge Widget Hub:
 *   - profile/theme come from the hub config (baked into the HTML per spawn)
 *   - closing the whip calls `fun_close_overlay("fun-whip")` instead of
 *     quitting an app
 *   - crack counts are shipped to the backend (fun_bump_count) in batches of
 *     5 so the Achievement engine's whip milestones work
 * Everything else — Verlet chain, grab hit-zone, tip-velocity crack gate,
 * impact VFX/SFX, motivational voice lines, keyboard Space sweep, idle sway,
 * milestone toasts — is the original behavior.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("stage");
  if (!canvas) return;

  const pillEl = document.getElementById("pill");
  const counterEl = document.getElementById("crack-count");
  const profileEl = document.getElementById("profile-select");
  const themeEl = document.getElementById("theme-select");
  const lifetimeEl = document.getElementById("pill-lifetime");
  const soundBtn = document.getElementById("sound-toggle");
  const closeBtn = document.getElementById("pill-close");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("pill-status");
  const sessionEl = document.getElementById("pill-session");

  // profile/theme are baked per spawn from the hub config; live changes in the
  // overlay apply to the current session.
  let profileId = window.__WHIP_PROFILE || "bullwhip";
  let themeId = window.__WHIP_THEME || "midnight";
  let allTime = { cracks: 0, bestStreak: 0 };
  try {
    const at = JSON.parse(localStorage.getItem("whipcracker.alltime") || "null");
    if (at && typeof at.cracks === "number") {
      allTime = { cracks: at.cracks, bestStreak: at.bestStreak || 0 };
    }
  } catch (e) {
    /* storage unavailable — defaults */
  }
  const savePrefs = () => {
    try {
      localStorage.setItem("whipcracker.alltime", JSON.stringify(allTime));
    } catch (e) {
      /* ignore */
    }
  };

  let sfx = null;
  let render = null;
  let whip = null;
  let crackCount = 0;
  let bestStreak = 0;
  let streak = 0;
  let lastCrackAt = -Infinity;
  let muted = false;
  try {
    muted = localStorage.getItem("whipcracker.muted") === "1";
  } catch (e) {
    /* ignore */
  }
  let unsentCracks = 0;

  let statusTimer = 0;
  const setStatus = (text, isError) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.add("visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("visible"), 3200);
  };

  // Ship batched crack counts to the backend (achievement milestones). Called
  // every 5 cracks and on close, so nothing is lost.
  const shipCracks = () => {
    if (unsentCracks <= 0) return;
    const n = unsentCracks;
    unsentCracks = 0;
    __invoke("fun_bump_count", { key: "whip_cracks", n }).catch(function () {
      /* backend gone — local count only */
    });
  };

  const closeApp = () => {
    shipCracks();
    if (sfx) {
      try {
        sfx.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    __invoke("fun_close_overlay", { label: "fun-whip" }).catch(function () {
      /* already closed */
    });
  };

  // ---- pill (control surface) ---------------------------------------------
  if (pillEl) pillEl.classList.add("visible");
  if (closeBtn) closeBtn.addEventListener("click", closeApp);
  if (soundBtn) {
    const setSoundLabel = () => {
      soundBtn.setAttribute("aria-pressed", String(!muted));
      soundBtn.textContent = muted ? "Sound: Off" : "Sound: On";
    };
    soundBtn.addEventListener("click", () => {
      muted = !muted;
      try {
        localStorage.setItem("whipcracker.muted", muted ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      setSoundLabel();
      setStatus(muted ? "Muted — the whip is disappointed" : "Sound on — the whip is pleased");
    });
    setSoundLabel();
  }
  const renderSession = () => {
    if (sessionEl) {
      sessionEl.textContent = `Session ${crackCount} cracks · best streak ×${bestStreak}`;
    }
  };
  const renderLifetime = () => {
    if (lifetimeEl) {
      lifetimeEl.textContent = `All time: ${allTime.cracks.toLocaleString()} cracks · best streak ×${allTime.bestStreak}`;
    }
  };

  // F11 clear (two-state confirm — never a one-click wipe)
  const clearState = WhipCracker.counter.createClear();
  let disarmTimer = 0;
  const clearLabel = () => {
    if (!clearBtn) return;
    clearBtn.textContent = clearState.armed ? "Confirm" : "Reset?";
    clearBtn.classList.toggle("armed", clearState.armed);
    clearBtn.setAttribute("aria-pressed", String(clearState.armed));
  };
  const disarmClear = () => {
    clearState.cancel();
    clearLabel();
  };
  const applyClear = () => {
    const zeroed = WhipCracker.counter.clearSession(crackCount, bestStreak);
    crackCount = zeroed.crackCount;
    streak = 0;
    bestStreak = zeroed.bestStreak;
    clearTimeout(disarmTimer);
    disarmClear();
    if (counterEl) counterEl.textContent = "0";
    renderSession();
    renderLifetime();
    setStatus(zeroed.cleared ? "Counter cleared — fresh slate" : "Nothing to clear yet");
  };
  const armClear = () => {
    clearState.arm();
    clearLabel();
    setStatus("Reset? — confirm again, or press Esc to cancel");
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(disarmClear, 4000);
  };
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (clearState.armed) applyClear();
      else armClear();
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F11") return;
    e.preventDefault();
    if (clearState.armed) applyClear();
    else armClear();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (clearState.armed) {
      clearTimeout(disarmTimer);
      disarmClear();
      setStatus("Clear cancelled — nothing was reset");
    } else {
      closeApp();
    }
  });
  renderSession();

  // ---- overlay: the whip itself -------------------------------------------
  whip = WhipCracker.engine.create({ profile: profileId });
  render = WhipCracker.renderer.create(canvas, { theme: themeId });
  sfx = WhipCracker.audio.create();

  // Idle rest pose: hangs from a fixed peg near the top-left, lazy-pendulum
  // sway while unheld so it feels alive (and stays grabbable).
  const ANCHOR = { x: 170, y: 120 };
  const SWAY = { ampX: 12, ampY: 5, periodMs: 3400, bobMs: 2400 };
  let idleT = 0;
  const swayPhase = Math.random() * Math.PI * 2;
  whip.setAnchor(ANCHOR.x, ANCHOR.y);
  whip.reset(ANCHOR.x, ANCHOR.y);

  // Hold Space → scripted radial sweep (same eased driver the machines use)
  const KB_CYCLE_MS = 900;
  const KB_SWEEP_W = 380;
  let kbActive = false;
  let kbT = 0;
  const kbTarget = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 3 });

  let cursor = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  let dragging = false;
  let hovering = false;
  let lastTs = performance.now();

  const down = (e) => {
    if (!whip.withinGrab(e.clientX, e.clientY)) return;
    dragging = true;
    sfx.init();
    whip.setDragging(true);
    e.preventDefault();
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    whip.release();
    updateHover(cursor.x, cursor.y);
  };
  const move = (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  };
  const updateHover = (x, y) => {
    hovering = !dragging && whip.withinGrab(x, y);
    canvas.style.cursor = dragging ? "grabbing" : hovering ? "grab" : "default";
    render.setGrip(dragging ? "grabbed" : hovering ? "hover" : "idle");
  };
  window.addEventListener("pointerdown", down);
  window.addEventListener("mousedown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("mouseup", up);
  window.addEventListener("pointermove", (e) => {
    move(e);
    updateHover(e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => {
    move(e);
    updateHover(e.clientX, e.clientY);
  });
  window.addEventListener("pointercancel", up);
  window.addEventListener("mouseleave", () => {
    if (kbActive) return;
    if (dragging) up();
  });

  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.code !== "Space" || dragging) return;
    kbActive = true;
    kbT = 0;
    dragging = true;
    sfx.init();
    whip.setDragging(true);
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !kbActive) return;
    kbActive = false;
    dragging = false;
    whip.release();
    e.preventDefault();
  });
  // Focus-loss safety net: Alt+Tab while Space is held must release the sweep
  window.addEventListener("blur", () => {
    if (!kbActive) return;
    kbActive = false;
    dragging = false;
    whip.release();
  });

  function resize() {
    render.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }
  window.addEventListener("resize", resize);
  resize();
  updateHover(cursor.x, cursor.y);

  // impact freeze (~100ms hit-stop so the comic stamp + burst own the screen)
  let hitStopUntil = 0;

  if (profileEl) profileEl.value = profileId;
  if (themeEl) themeEl.value = themeId;
  if (profileEl) {
    profileEl.addEventListener("change", () => {
      const next = profileEl.value;
      if (next === profileId) return;
      profileId = next;
      if (dragging) up();
      whip = WhipCracker.engine.create({ profile: profileId });
      whip.setAnchor(ANCHOR.x, ANCHOR.y);
      whip.reset(ANCHOR.x, ANCHOR.y);
      dragging = false;
      kbActive = false;
      hitStopUntil = 0;
      const name = (WhipCracker.PROFILES[profileId] || {}).name || profileId;
      setStatus(`Switched to the ${name}`);
    });
  }
  if (themeEl) {
    themeEl.addEventListener("change", () => {
      const next = themeEl.value;
      if (next === themeId) return;
      themeId = next;
      render.setTheme(themeId);
      setStatus(`Theme: ${(WhipCracker.THEMES[themeId] || {}).name || themeId}`);
    });
  }

  const MILESTONES = [
    [10, "10 cracks — the whip is now a percussion instrument"],
    [25, "25 cracks — your forearm has filed a complaint"],
    [50, "50 cracks — the whip has unionized"],
    [100, "100 cracks — air is legally required to break for you"],
    [250, "250 cracks — the drill sergeant is emotionally invested"],
    [500, "500 cracks — the whip writes home about you"],
  ];
  let nextMilestone = 0;

  function onCrack(ev) {
    const nowMs = performance.now();
    streak = nowMs - lastCrackAt < 2600 ? streak + 1 : 1;
    lastCrackAt = nowMs;
    if (streak > bestStreak) bestStreak = streak;
    crackCount += 1;
    allTime.cracks += 1;
    if (streak > allTime.bestStreak) allTime.bestStreak = streak;
    unsentCracks += 1;
    if (unsentCracks % 5 === 0) shipCracks();
    hitStopUntil = nowMs + 100;
    render.impact(ev.x, ev.y, ev.vx, ev.vy, ev.tipVelocity, ev.power);
    if (!muted) sfx.crack(ev.power);
    const line = !muted ? sfx.sayLine(streak) : null;
    if (line) render.sayLine(line);
    while (nextMilestone < MILESTONES.length && crackCount >= MILESTONES[nextMilestone][0]) {
      render.toast(MILESTONES[nextMilestone][1]);
      nextMilestone++;
    }
    if (counterEl) counterEl.textContent = String(crackCount);
    renderSession();
    renderLifetime();
  }

  function loop(ts) {
    const dtMs = Math.min(100, ts - lastTs);
    lastTs = ts;
    const dt = dtMs / 1000;
    const frozen = ts < hitStopUntil;
    if (!frozen) {
      if (!dragging) {
        idleT += dtMs;
        const ph = swayPhase + (idleT / SWAY.periodMs) * Math.PI * 2;
        const bob = (idleT / SWAY.bobMs) * Math.PI * 2;
        whip.setAnchor(
          ANCHOR.x + Math.sin(ph) * SWAY.ampX,
          ANCHOR.y + Math.sin(bob) * SWAY.ampY * 0.5 + Math.abs(Math.cos(ph * 0.5)) * SWAY.ampY * 0.5
        );
      }
      let hx = cursor.x;
      let hy = cursor.y;
      if (kbActive) {
        kbT += dtMs;
        const t = kbTarget();
        const p = WhipCracker.engine.sweepPos(ANCHOR.x, ANCHOR.y, t.x, t.y, kbT, KB_CYCLE_MS, KB_SWEEP_W);
        hx = p.x;
        hy = p.y;
      }
      const crack = whip.step(dt, hx, hy);
      if (crack) onCrack(crack);
      if (dragging && !muted) sfx.swish(whip.tipVelocity, streak);
    }
    render.draw(whip, dtMs);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  renderLifetime();

  // tuning hook (playtesting) — same surface as the standalone app
  window.__whip = {
    get whip() {
      return whip;
    },
    get config() {
      return whip.config;
    },
    get profileId() {
      return profileId;
    },
    get themeId() {
      return themeId;
    },
    get allTime() {
      return allTime;
    },
    render,
    frozenNow: () => performance.now() < hitStopUntil,
  };
})();

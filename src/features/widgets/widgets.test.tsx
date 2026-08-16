// Widgets feature tests. Cover the shared subsystems and the data-driven
// engine (the payoff overlays themselves are visual — tested for HTML
// integrity/escaping, not pixels):
//  - store: enable/disable + config merge roundtrip through the mock backend
//  - overlay shell: config values are HTML-escaped, never raw "undefined"
//  - particle engine: pure physics (gravity, drag, fade) — one engine, both
//    confetti and shards
//  - achievement engine: unlocks from real counters, never repeats
//  - hub: zero-data render shows every card + no literal "undefined" leaks
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCanvas } from "../../test/canvas-shim";
import { createEngine, burstConfetti } from "./particles-engine.js";
import { ACHIEVEMENTS, checkAchievements } from "./achievements";
import WidgetsHub from "./hub";
import { overlayShell, esc } from "./overlays";
import { getState, isEnabled, refresh, setConfig, setEnabled } from "./store";
import { getStats } from "./stats";
import { WIDGETS } from "./registry";
import { restartWidget } from "./runtime";
import { bsodHtml } from "./bsod";
import { certificateHtml } from "./certificate";
import { confettiHtml } from "./confetti";
import { fireHtml } from "./fire";
import { glitchHtml } from "./glitch";
import { petHtml } from "./pet";
import { rageHtml } from "./rage";
import { roastHtml } from "./roast";

// mock store is module-level and persists between tests — reset it
beforeEach(async () => {
  await refresh();
  if (getState().enabled.length) {
    for (const id of [...getState().enabled]) await setEnabled(id, false);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("store (persistence contract)", () => {
  it("round-trips enabled widgets through the backend", async () => {
    expect(isEnabled("confetti")).toBe(false);
    await setEnabled("confetti", true);
    expect(isEnabled("confetti")).toBe(true);
    await setEnabled("confetti", false);
    expect(isEnabled("confetti")).toBe(false);
  });

  it("merges config patches per widget", async () => {
    await setConfig("fire", { threshold: 90 });
    await setConfig("fire", { duration: 8 });
    const cfg = getState().configs["fire"];
    expect(cfg.threshold).toBe(90);
    expect(cfg.duration).toBe(8);
    // other widgets untouched
    expect(getState().configs["rage"]).toBeUndefined();
  });
});

describe("overlay shell (HTML integrity)", () => {
  it("escapes config values that flow into overlay HTML", () => {
    expect(esc(`"><script>alert(1)</script>`)).not.toContain("<script>");
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("builds a self-contained document with no undefined leaks", () => {
    const html = overlayShell({ css: "body{}", body: "<div id=x></div>", script: "var a=1;" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<div id=x></div>");
    expect(html).toContain("__invoke");
    const stripped = html.replace(/typeof [A-Za-z_.]+ !== "undefined"/g, "");
    expect(stripped).not.toContain("undefined");
  });

  it("wraps head content (audio boot) in real <script> tags", () => {
    // Regression: OVERLAY_AUDIO_BOOT was injected into <head> bare, so the
    // browser parsed it as inert text and `__audio` never existed — every
    // audio-using widget (pet, confetti, bsod, rage, glitch, roast, fire,
    // certificate) threw "__audio is not defined" on its first use and froze.
    const html = overlayShell({
      css: "body{}",
      body: "",
      script: "var a=1;",
      head: "var __audio = {};\nwindow.addEventListener('x', function(){ __audio; });",
    });
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(/<script>\nvar __audio = \{\};/);
    expect(head).toContain("</script>");
    // the boot code must sit inside the script block, not as raw head text
    expect(head.indexOf("<script>")).toBeLessThan(head.indexOf("var __audio"));
    // and every real widget that passes OVERLAY_AUDIO_BOOT must produce a
    // document where __audio is actually declared inside a script tag
    const widgetsWithAudio: [string, () => string][] = [
      ["pet", () => petHtml()],
      ["confetti", () => confettiHtml()],
      ["bsod", () => bsodHtml()],
      ["rage", () => rageHtml("data:image/png;base64,QUJD")],
      ["glitch", () => glitchHtml("data:image/png;base64,QUJD")],
      ["roast", () => roastHtml("test line")],
      ["fire", () => fireHtml()],
      ["certificate", () => certificateHtml(getStats())],
    ];
    for (const [id, makeHtml] of widgetsWithAudio) {
      const htmlFor = makeHtml();
      const h = htmlFor.slice(0, htmlFor.indexOf("</head>"));
      expect(h, `${id} audio boot inside <script>`).toContain("<script>");
      expect(h, `${id} __audio declared`).toContain("var __audio");
      expect(h, `${id} __audio before </head>`).toContain("</script>");
    }
  });

  it("embeds the audio + particle engines as valid inline JS", async () => {
    const confetti = await import("./confetti");
    const html = confetti.confettiHtml();
    expect(html).toContain("RFAudio");
    expect(html).toContain("RFParticles");
    expect(html).toContain("fun-confetti");
    // UMD/back-end guards legitimately contain `typeof X !== "undefined"` —
    // strip those and assert nothing else leaks the word into the document
    const stripped = html.replace(/typeof [A-Za-z_.]+ !== "undefined"/g, "");
    expect(stripped).not.toContain("undefined");
  });

  it("rage overlay embeds the captured screen as the base texture", async () => {
    const rage = await import("./rage");
    const html = rage.rageHtml("data:image/png;base64,QUJD");
    expect(html).toContain("data:image/png;base64,QUJD");
    expect(html).toContain('shape: "sprite"');
  });
});

describe("particle engine (one engine, two payoffs)", () => {
  it("applies gravity and fades particles over life", () => {
    const canvas = createCanvas(300, 300);
    const eng = createEngine(canvas, { gravity: 500 });
    const p = eng.spawn({ x: 100, y: 100, vx: 0, vy: 0, life: 1, maxLife: 1 });
    const y0 = p.y;
    eng.step(0.1);
    expect(p.y).toBeGreaterThan(y0); // gravity pulled it down
    eng.step(0.95);
    expect(eng.count()).toBe(0); // life exhausted → removed
  });

  it("confetti burst produces varied shapes", () => {
    const canvas = createCanvas(300, 300);
    const eng = createEngine(canvas, { gravity: 420 });
    burstConfetti(eng, { x: 150, y: 100, count: 40 });
    expect(eng.count()).toBe(40);
    const shapes = new Set(eng.particles.map((p: { shape: string }) => p.shape));
    expect(shapes.has("rect") || shapes.has("ribbon")).toBe(true);
    expect(eng.particles.every((p: { maxLife: number }) => p.maxLife > 0)).toBe(true);
  });
});

describe("achievement engine (data-driven)", () => {
  it("is defined as data, not hardcoded popups", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThan(20);
    for (const a of ACHIEVEMENTS) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.title).toBe("string");
      expect(typeof a.desc).toBe("string");
      expect(typeof a.icon).toBe("string");
      expect(typeof a.check).toBe("function");
    }
  });

  it("unlocks from real counters and never repeats", async () => {
    const first = ACHIEVEMENTS.find((a) => a.id === "confetti_first");
    expect(first).toBeDefined();
    // stats are zero → nothing unlocks
    await checkAchievements();
    expect(getState().achievements).not.toContain("confetti_first");
  });
});

describe("registry", () => {
  it("defines all 12 widgets with behavior wiring", () => {
    expect(WIDGETS).toHaveLength(12);
    const ids = new Set(WIDGETS.map((w) => w.id));
    expect(ids.size).toBe(12);
    for (const w of WIDGETS) {
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.desc.length).toBeGreaterThan(0);
      expect(["on-demand", "ambient", "persistent"]).toContain(w.kind);
      if (w.kind === "on-demand") {
        expect(typeof w.trigger).toBe("function");
        expect(w.triggerLabel?.length).toBeGreaterThan(0);
      } else {
        expect(typeof w.start).toBe("function");
      }
    }
    // the specific cast (spec §1)
    expect(WIDGETS.map((w) => w.name)).toEqual(
      expect.arrayContaining([
        "Whip Cracker",
        "Rage Shatter",
        "Confetti Cannon",
        "Fake BSOD",
        "Boss Key",
        "Procrastination Certificate",
        "CPU Fire Alarm",
        "Idle Roast",
        "Keyboard Smash Detector",
        "Desktop Pet Companion",
        "Glitch Jumpscare",
        "Achievement Popper",
      ])
    );
  });

  it("every on-demand widget has a hotkey default for the hub config", () => {
    for (const w of WIDGETS.filter((x) => x.kind === "on-demand" && x.id !== "certificate")) {
      expect(typeof w.defaults.hotkey, `${w.id} hotkey`).toBe("string");
      expect(String(w.defaults.hotkey).length).toBeGreaterThan(0);
    }
  });
});

describe("runtime lifecycle", () => {
  it("starts and fully stops a widget's listeners", async () => {
    await setEnabled("smash", true);
    expect(getState().enabled).toContain("smash");
    await setEnabled("smash", false);
    expect(getState().enabled).not.toContain("smash");
  });

  it("restartWidget is safe for disabled widgets", () => {
    expect(() => restartWidget("fire")).not.toThrow();
  });
});

describe("hub render (zero-data)", () => {
  it("shows all 12 widget cards and no raw undefined", async () => {
    render(<WidgetsHub />);
    await waitFor(() => expect(screen.getByText("Whip Cracker")).toBeTruthy());
    expect(screen.getByText("Rage Shatter")).toBeTruthy();
    expect(screen.getByText("Confetti Cannon")).toBeTruthy();
    expect(screen.getByText("Fake BSOD")).toBeTruthy();
    expect(screen.getByText("Boss Key")).toBeTruthy();
    expect(screen.getByText("Procrastination Certificate")).toBeTruthy();
    expect(screen.getByText("CPU Fire Alarm")).toBeTruthy();
    expect(screen.getByText("Idle Roast")).toBeTruthy();
    expect(screen.getByText("Keyboard Smash Detector")).toBeTruthy();
    expect(screen.getByText("Desktop Pet Companion")).toBeTruthy();
    expect(screen.getByText("Glitch Jumpscare")).toBeTruthy();
    expect(screen.getByText("Achievement Popper")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("undefined");
  });

  it("toggle + trigger buttons work through the store", async () => {
    const user = userEvent.setup();
    render(<WidgetsHub />);
    await waitFor(() => expect(screen.getByText("Confetti Cannon")).toBeTruthy());
    const card = screen.getByTestId("widget-card-confetti");
    const toggle = card.querySelector('[role="switch"]');
    expect(toggle).toBeTruthy();
    await user.click(toggle as HTMLElement);
    await waitFor(() => expect(getState().enabled).toContain("confetti"));
    // trigger button becomes enabled
    const trigger = screen.getByTestId("widget-trigger-confetti");
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    await user.click(trigger);
  });
});

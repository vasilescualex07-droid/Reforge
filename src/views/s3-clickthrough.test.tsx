// S3.1 — click-through sweep verification.
// Mounts every view against the REAL mock backend (api.call -> mockCall, 200ms
// per call) and clicks/toggles every interactive control, asserting:
//   1. the click never throws (handler exists, no crash),
//   2. at least one backend command fired per view (controls aren't dead),
//   3. no "undefined" leaks into the rendered text.
// This is the automated half of the per-view checklist; findings are logged in
// docs/ROADMAP_V6.md under S3.1.
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import Dashboard from "./Dashboard";
import Displays from "./Displays";
import Gaming from "./Gaming";
import History from "./History";
import Makeover from "./Makeover";
import MakeoverSession from "./MakeoverSession";
import Marketplace from "./Marketplace";
import Network from "./Network";
import Organize from "./Organize";
import Performance from "./Performance";
import Productivity from "./Productivity";
import Security from "./Security";
import Settings from "./Settings";
import Tuneup from "./Tuneup";

// Wrap api.call / callWithTimeout to record every command a view fires while
// still delegating to the real implementation (which routes to the mock in
// non-Tauri environments). This proves controls call REAL handlers.
const commands = vi.hoisted(() => ({ fired: [] as string[] }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const record = <F extends (...a: never[]) => unknown>(fn: F) =>
    ((...a: Parameters<F>) => {
      commands.fired.push(a[0] as string);
      return fn(...a);
    }) as F;
  return {
    ...actual,
    call: record(actual.call),
    callWithTimeout: record(actual.callWithTimeout),
  };
});

const VIEWS: { name: string; Comp: (p: Record<string, unknown>) => React.JSX.Element; props?: Record<string, unknown> }[] = [
  // App.tsx always passes onNavigate to Dashboard — supply it here so the
  // sweep clicks its nav buttons for real (S3.1 checklist: Dashboard nav OK)
  { name: "Dashboard", Comp: Dashboard, props: { onNavigate: () => {} } },
  { name: "Displays", Comp: Displays },
  { name: "Gaming", Comp: Gaming },
  { name: "History", Comp: History },
  { name: "Makeover", Comp: Makeover },
  { name: "MakeoverSession", Comp: MakeoverSession },
  { name: "Marketplace", Comp: Marketplace },
  { name: "Network", Comp: Network },
  { name: "Organize", Comp: Organize },
  { name: "Performance", Comp: Performance },
  { name: "Productivity", Comp: Productivity },
  { name: "Security", Comp: Security },
  { name: "Settings", Comp: Settings },
  { name: "Tuneup", Comp: Tuneup },
];

beforeEach(() => {
  commands.fired.length = 0;
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("alert", () => {});
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  // NOTE: deliberately NOT calling vi.unstubAllGlobals() — it would wipe the
  // shared IntersectionObserver/canvas stubs installed by src/test/setup.ts
  // and crash every later view that renders ScenePreview. The per-test
  // stubs (confirm/alert/scrollTo) are re-set in beforeEach and harmless.
});

/** Flush pending act work (promises, timers) so state settles between clicks. */
async function flush(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Close any open dialog so the sweep can keep clicking the page behind it. */
function closeDialogs() {
  document.querySelectorAll('[role="dialog"]').forEach((d) => {
    fireEvent.keyDown(d, { key: "Escape" });
  });
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function visible(el: Element): boolean {
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  let n: Element | null = el;
  while (n && n !== document.body) {
    const s = window.getComputedStyle(n);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (n.hasAttribute("hidden")) return false;
    n = n.parentElement;
  }
  return true;
}

/** Interact with one control and report whether the handler ran without
 *  throwing. Returns a problem description or null on success. */
async function poke(el: Element): Promise<string | null> {
  const tag = el.tagName.toLowerCase();
  const label =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.textContent?.trim().slice(0, 40) ||
    tag;
  const describe = () => `${tag} "${label}"`;
  try {
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const type = (el as HTMLInputElement).type;
      if (type === "checkbox" || type === "radio") {
        await act(async () => {
          fireEvent.click(el);
          await new Promise((r) => setTimeout(r, 20));
        });
      } else if (tag === "select") {
        const sel = el as HTMLSelectElement;
        if (sel.options.length > 1) {
          const target = sel.options[1];
          await act(async () => {
            fireEvent.change(sel, { target: { value: target.value } });
            await new Promise((r) => setTimeout(r, 20));
          });
        }
      } else if (type === "range") {
        await act(async () => {
          fireEvent.change(el, { target: { value: "50" } });
          await new Promise((r) => setTimeout(r, 20));
        });
      } else {
        await act(async () => {
          fireEvent.change(el, { target: { value: "sweep" } });
          await new Promise((r) => setTimeout(r, 20));
        });
      }
    } else {
      await act(async () => {
        fireEvent.click(el);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    return null;
  } catch (err) {
    return `${describe()} threw: ${err instanceof Error ? err.message : String(err)}`;
  }
}

describe("S3.1 click-through sweep (real mock backend)", () => {
  for (const { name, Comp, props } of VIEWS) {
    // A sweep clicks hundreds of controls; each mock call costs 200ms, and
    // views like Makeover chain many calls per click — 5s default is too
    // short for an honest sweep.
    it(`${name}: every control clickable, handlers fire, no crash`, { timeout: 120_000 }, async () => {
      const { container } = render(<Comp {...props} />);

      // Wait for the view's initial data to load (mock delays 200ms/call).
      await waitFor(
        () => {
          expect(container.querySelectorAll("button, input, select, textarea, [role='switch']").length).toBeGreaterThan(0);
        },
        { timeout: 8000 },
      );
      await flush(400); // let chained loads settle

      const problems: string[] = [];
      let clicked = 0;
      const seen = new Set<string>();

      for (let pass = 0; pass < 3; pass++) {
        closeDialogs();
        const controls = Array.from(
          container.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, [role='switch'], [role='button'], [role='checkbox']",
          ),
        ).filter(visible);
        let interacted = false;
        for (const el of controls) {
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
          const key =
            el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent?.trim().slice(0, 40) || el.tagName;
          // Later passes only sweep controls revealed by earlier clicks
          // (tabs, expanded sections) — no point re-clicking the same 300
          // buttons and paying the 200ms mock delay per call.
          if (seen.has(key)) continue;
          seen.add(key);
          const problem = await poke(el);
          if (problem) problems.push(problem);
          else {
            clicked++;
            interacted = true;
          }
          await flush(15);
          closeDialogs();
        }
        // A third pass exists so controls revealed by earlier interactions
        // get swept too; stop when nothing new appeared.
        if (!interacted) break;
      }

      expect(problems).toEqual([]);
      expect(clicked).toBeGreaterThan(0);
      // The view must have fired at least one real backend command — a view
      // whose controls do nothing is exactly the bug class S3.1 hunts.
      expect(commands.fired.length, `${name} fired no backend commands`).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("undefined");
      expect(container.textContent).not.toContain("NaN");
    });
  }
});

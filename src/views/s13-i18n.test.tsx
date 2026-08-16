// S13.5 — i18n framework tests:
//   - key parity: every en.json key exists in es.json and vice versa (the
//     "one full locale as proof" gate — a missing key would silently fall
//     back to English, so parity is the contract).
//   - t(): dot-notation lookup, {var} interpolation, and the en → key
//     fallback for unknown keys (visible, fixable, never a crash).
//   - the Settings language switcher actually flips UI strings.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import en from "../i18n/en.json";
import es from "../i18n/es.json";

const STORE_KEY = "reforge-mock-v1";

async function reloadedMock() {
  vi.resetModules();
  return import("../lib/mock");
}

afterEach(() => {
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem("reforge-lang");
  vi.resetModules();
});

describe("S13.5 i18n catalogs", () => {
  it("es.json has full key parity with en.json (proof locale)", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("es values are real translations (only proper nouns / code terms stay English)", () => {
    const identical = Object.keys(en).filter((k) => es[k as keyof typeof es] === en[k as keyof typeof en]);
    // Marketplace/Widgets (borrowed nouns), Tauri (brand), commit (code term)
    // legitimately stay English — nothing else may.
    expect(identical.sort()).toEqual(["nav.marketplace", "nav.widgets", "settings.about.commit", "settings.about.native"].sort());
  });

  it("t() interpolates {vars} and falls back to the key for unknown strings", async () => {
    const i18n = await import("../i18n");
    const { render } = await import("@testing-library/react");
    function Probe() {
      const { t } = i18n.useI18n();
      return (
        <div>
          <span data-testid="version">{t("settings.about.version", { version: "9.9.9" })}</span>
          <span data-testid="nope">{t("no.such.key")}</span>
        </div>
      );
    }
    const { getByTestId } = render(
      <i18n.I18nProvider>
        <Probe />
      </i18n.I18nProvider>,
    );
    expect(getByTestId("version").textContent).toBe("Version 9.9.9");
    // unknown keys degrade to the key itself — visible, never a crash
    expect(getByTestId("nope").textContent).toBe("no.such.key");
  });
});

describe("S13.5 language switcher", () => {
  it("switching to Español in Settings flips labels, back to English restores them", { timeout: 120_000 }, async () => {
    await reloadedMock();
    const i18n = await import("../i18n");
    const { default: Settings } = await import("./Settings");
    const { container } = render(
      <i18n.I18nProvider>
        <Settings />
      </i18n.I18nProvider>,
    );
    await waitFor(() => expect(container.textContent).toContain("Automation"), { timeout: 8000 });

    const select = container.querySelector('select[aria-label="Language"]') as HTMLSelectElement;
    expect(select).not.toBeNull();

    fireEvent.change(select, { target: { value: "es" } });
    await waitFor(() => expect(container.textContent).toContain("Automatización"), { timeout: 8000 });
    expect(container.textContent).toContain("Acerca de Reforge");
    // interpolation works in the target locale too
    expect(container.textContent).toContain("Versión");

    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() => expect(container.textContent).toContain("Automation"), { timeout: 8000 });
  });
});

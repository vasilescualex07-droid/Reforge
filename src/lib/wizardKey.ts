// Shared first-run wizard key. Lives in its own zero-dependency module so the
// app shell (App.tsx) can read it without pulling in the style catalog — the
// Wizard component that writes it is code-split.
export const WIZARD_KEY = "reforge-wizard-seen-v1";

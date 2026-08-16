// Tiny event bus: lets the command palette (and future shortcuts) trigger
// real actions inside views, instead of only navigating.

export function fireAction(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(`reforge:${name}`, { detail }));
}

export function onAction(name: string, fn: (detail?: unknown) => void) {
  const handler = (e: Event) => fn((e as CustomEvent).detail);
  window.addEventListener(`reforge:${name}`, handler);
  return () => window.removeEventListener(`reforge:${name}`, handler);
}

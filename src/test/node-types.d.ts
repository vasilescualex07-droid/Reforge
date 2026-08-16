// Minimal ambient node types for tests that read files from disk (e.g. the
// S13 index.css snapshot). vitest runs under node so these exist at runtime;
// the frontend tsconfig has no @types/node, so declare just what's used here.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare const process: { cwd(): string };

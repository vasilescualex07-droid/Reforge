// S1.6 — react-hooks lint gate (fixes K3: hand-written dep arrays).
// Deliberately minimal: only the two React hooks rules run. No recommended
// style/type rules — those would flood the gate with unrelated noise; this is
// a focused correctness gate, wired into test:ci via `npm run lint`.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", "public"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
);

// S10.8 — first-run wizard: three questions, starter style built through the
// SAME quiz engine Makeover uses (buildMyStyle + apply). Lives in its own
// code-split chunk so the style catalog never lands in the app shell.
import { useState } from "react";
import { call, swallow } from "../lib/api";
import { Modal, toast } from "./ui";
import { applyStyleDef } from "../lib/styleApply";
import { buildMyStyle, EMPTY_ANSWERS, type QuizAnswers } from "../styles";
import { WIZARD_KEY } from "../lib/wizardKey";

const WIZ_QUESTIONS: { q: string; options: { label: string; w: Partial<QuizAnswers> }[] }[] = [
  {
    q: "What mood fits your space?",
    options: [
      { label: "Calm & minimal", w: { calm: 3, minimal: 2 } },
      { label: "Dark & focused", w: { focused: 3, dark: 2 } },
      { label: "Bold & vibrant", w: { energetic: 3, vivid: 2 } },
      { label: "Warm & cozy", w: { cozy: 3, warm: 2 } },
    ],
  },
  {
    q: "How do you use your PC most?",
    options: [
      { label: "Deep work & study", w: { focused: 2, minimal: 1 } },
      { label: "Gaming & play", w: { gaming: 3, energetic: 1 } },
      { label: "Creating", w: { vivid: 2, bold: 1 } },
      { label: "A bit of everything", w: { calm: 1, neutral: 1 } },
    ],
  },
  {
    q: "Pick a backdrop vibe",
    options: [
      { label: "Nature", w: { nature: 3, calm: 1 } },
      { label: "City nights", w: { city: 3, dark: 1 } },
      { label: "Deep space", w: { space: 3, dark: 1 } },
      { label: "Abstract", w: { abstract: 3, bold: 1 } },
    ],
  },
];

export default function Wizard({
  open,
  onDone,
  onSkip,
}: {
  open: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [wizStep, setWizStep] = useState(0);
  const [wizAnswers, setWizAnswers] = useState<QuizAnswers>(EMPTY_ANSWERS);
  const [wizApplying, setWizApplying] = useState(false);

  // Persist durably so the wizard never reappears on the next launch
  // (backend data_dir/onboarding.json; localStorage is the browser fallback).
  const markSeen = () => {
    localStorage.setItem(WIZARD_KEY, "1");
    call("set_onboarding_state", { onb: { wizard_seen: true } }).catch((e) => swallow("set_onboarding_state", e));
  };

  const dismiss = () => {
    markSeen();
    onSkip();
  };

  const wizPick = (opt: { label: string; w: Partial<QuizAnswers> }) => {
    const next = { ...wizAnswers };
    for (const [k, v] of Object.entries(opt.w)) next[k as keyof QuizAnswers] = (next[k as keyof QuizAnswers] ?? 0) + (v ?? 0);
    setWizAnswers(next);
    if (wizStep < WIZ_QUESTIONS.length - 1) {
      setWizStep((s) => s + 1);
    } else {
      // last question → build + apply the starter style
      setWizApplying(true);
      const style = buildMyStyle(next);
      applyStyleDef(style)
        .then((res) => {
          toast(`Applied your starter look “${res.name}” — tweak anytime in Makeover`);
        })
        .catch((e) => swallow("wizard apply", e))
        .finally(() => {
          setWizApplying(false);
          markSeen();
          onDone();
        });
    }
  };

  return (
    <Modal
      open={open}
      title={wizStep === 0 ? "Welcome to Reforge" : `Question ${wizStep + 1} of ${WIZ_QUESTIONS.length}`}
      onClose={dismiss}
    >
      {wizStep < WIZ_QUESTIONS.length ? (
        <>
          <p className="text-xs text-[var(--text-secondary)]">
            {wizStep === 0
              ? "Three quick questions — we'll build a starter look from your answers. Every change is reversible from History."
              : "One more — what kind of backdrop do you want?"}
          </p>
          <div className="mt-4 grid gap-2">
            {WIZ_QUESTIONS[wizStep].options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => wizPick(opt)}
                disabled={wizApplying}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2.5 text-left text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-accent)]"
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button className="mt-3 text-2xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]" onClick={dismiss}>
            Skip — I'll explore first
          </button>
        </>
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">{wizApplying ? "Building your starter look…" : "Done"}</p>
      )}
    </Modal>
  );
}

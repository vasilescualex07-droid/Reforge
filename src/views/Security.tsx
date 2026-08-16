import { useCallback, useEffect, useState } from "react";
import { errorCopy, call } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { AuditItem, PermissionState, PrivacyPolicyItem, UsbDevice } from "../lib/types";
import { InlineAlert, Modal, Section, StatusDot, Toggle, toast } from "../components/ui";
import {
  IconShieldCheck, IconShieldAlert, IconShieldX,
  IconScan, IconFingerprint, IconRefresh,
} from "../components/icons";

interface HealthStatus {
  overall_status: string;
  antivirus: { name: string; enabled: boolean; up_to_date: boolean }[];
  firewall: { name: string; enabled: boolean }[];
  third_party_active: boolean;
  tamper_protection_on: boolean | null;
  defender_detail: {
    real_time_protection_on: boolean | null;
    signature_age_days: number | null;
    definitions_up_to_date: boolean | null;
    tamper_protection: boolean | null;
  } | null;
}

interface ThreatEntry {
  id: string;
  name: string;
  severity: string;
  category_description: string;
  date: string;
  state: string;
  path: string;
}

interface ScanHistoryEntry {
  ts: number;
  scan_type: string;
  result: string;
  threats_found: number;
}

interface FlaggedEntry {
  name: string;
  location: string;
  command: string;
  flags: string[];
  is_signed: boolean | null;
}



const HEALTH_COLORS: Record<string, string> = {
  healthy: "border-[var(--status-success-border)] bg-[var(--status-success-bg)]",
  attention: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]",
  critical: "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]",
  unknown: "border-[var(--border-default)] bg-[var(--surface-overlay)]",
};

export default function Security() {
  const [_items, setItems] = useState<AuditItem[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [scanHist, setScanHist] = useState<ScanHistoryEntry[]>([]);
  const [threats, setThreats] = useState<ThreatEntry[]>([]);
  const [_flagged, setFlagged] = useState<FlaggedEntry[]>([]);
  const [cfaMode, setCfaMode] = useState("disabled");
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirmLabel: string; run: () => void } | null>(null);

  // S2.2 — the Privacy Audit trio + ASR rules load through useLoad: real
  // error surfaces, one toast per command per session on first failure.
  const { data: perms, error: permsError } = useLoad<PermissionState[]>("get_permissions");
  const { data: privacy, error: privacyError } = useLoad<PrivacyPolicyItem[]>("get_browser_privacy");
  const { data: usb, error: usbError } = useLoad<UsbDevice[]>("get_usb_history");
  const { data: asrRules, error: asrError, refresh: refreshAsr } = useLoad<{ id: string; name: string; action: string }[]>("security_list_asr_rules");

  const run = useCallback(async () => {
    setScanning(true);
    try {
      const [r, h, sh, th, fl, cfa] = await Promise.all([
        call<AuditItem[]>("get_security_audit"),
        call<HealthStatus>("security_get_health_status"),
        call<ScanHistoryEntry[]>("security_get_scan_history"),
        call<ThreatEntry[]>("security_list_threats"),
        call<FlaggedEntry[]>("security_audit_autorun_threat_surface"),
        call<{ mode: string }>("security_get_cfa_status"),
      ]);
      setItems(r);
      setHealth(h);
      setScanHist(sh);
      setThreats(th);
      setFlagged(fl);
      setCfaMode(cfa.mode);
      refreshAsr();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setScanning(false);
    }
  }, [refreshAsr]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <header className="page-head flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Security & Threat Protection</h1>
          <p className="page-subtitle">
            Everything reads from Windows' real security stack. No invented verdicts, no fake green checkmarks.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={run} disabled={scanning}>
          <IconRefresh size={14} /> {scanning ? "Loading…" : "Refresh"}
        </button>
      </header>

      {/* Security Health Dashboard */}
      {health && (
        <Section title="Security Health" subtitle="Real-time status from Windows Security Center and Defender">
          <div className="flex items-center gap-6">
            <div
              className={`rounded-2xl border px-6 py-4 text-center ${HEALTH_COLORS[health.overall_status] ?? HEALTH_COLORS.unknown}`}
            >
              <div className="mb-1">
                {health.overall_status === "healthy" ? (
                  <IconShieldCheck size={28} className="mx-auto text-[var(--status-success)]" />
                ) : health.overall_status === "attention" ? (
                  <IconShieldAlert size={28} className="mx-auto text-[var(--status-warning)]" />
                ) : (
                  <IconShieldX size={28} className="mx-auto text-[var(--status-danger)]" />
                )}
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                {health.overall_status}
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                <span className="text-[var(--text-tertiary)]">AV:</span>
                {health.antivirus.map((a) => a.name).join(", ") || "none"}
                {health.third_party_active && (
                  <span className="badge badge-info">3rd party</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                <span className="text-[var(--text-tertiary)]">Firewall:</span>
                <StatusDot status={health.firewall.some((f) => f.enabled) ? "success" : "danger"} />
                {health.firewall.some((f) => f.enabled) ? "ON" : "OFF"}
              </div>
              {health.defender_detail && (
                <>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">RT Protection:</span>
                    <StatusDot status={health.defender_detail.real_time_protection_on ? "success" : "danger"} />
                    {health.defender_detail.real_time_protection_on ? "On" : "Off"}
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">Definitions:</span>
                    <StatusDot status={health.defender_detail.definitions_up_to_date ? "success" : "warning"} />
                    {health.defender_detail.definitions_up_to_date
                      ? "Up to date"
                      : `Stale (${health.defender_detail.signature_age_days ?? "?"}d)`}
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">Tamper:</span>
                    <StatusDot status={health.tamper_protection_on ? "success" : "warning"} />
                    {health.tamper_protection_on ? "On" : "Off"}
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  call("security_trigger_scan", { scan_type: "quick" })
                    .then((r: any) => toast(r))
                    .catch((e) => toast(errorCopy(e), "err"));
                }}
              >
                <IconScan size={13} /> Quick Scan
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  call("security_trigger_scan", { scan_type: "full" })
                    .then((r: any) => toast(r))
                    .catch((e) => toast(errorCopy(e), "err"));
                }}
              >
                <IconScan size={13} /> Full Scan
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  call("security_update_definitions")
                    .then((r: any) => toast(r))
                    .catch((e) => toast(errorCopy(e), "err"));
                }}
              >
                Update Defs
              </button>
            </div>
          </div>

          {/* Scan history */}
          {scanHist.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Recent scans</div>
              {scanHist.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <span className="w-16 shrink-0 capitalize">{s.scan_type}</span>
                  <StatusDot status={s.result === "completed" ? "success" : "danger"} />
                  <span className={s.result === "completed" ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}>
                    {s.result}
                  </span>
                  {s.threats_found > 0 && (
                    <span className="badge badge-danger">{s.threats_found} threat(s)</span>
                  )}
                  <span className="text-[var(--text-tertiary)]">{new Date(s.ts).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Threat & Quarantine Review */}
      {threats.length > 0 && (
        <Section title="Threat & Quarantine Review" subtitle={`${threats.length} items from Defender's real detection log`}>
          <div className="space-y-2">
            {threats.slice(0, 10).map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {t.name || "Unknown process"}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">{t.category_description}</div>
                    <div className="mt-0.5 text-2xs text-[var(--text-tertiary)]">
                      State: {t.state} · {t.date.substring(0, 10)}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      className="btn-ghost text-2xs"
                      onClick={() =>
                        call("security_restore_threat", { threat_id: t.id })
                          .then((r: any) => toast(r))
                          .catch((e) => toast(errorCopy(e), "err"))
                      }
                    >
                      Restore
                    </button>
                    <button
                      className="btn-ghost text-2xs text-[var(--status-danger)]"
                      onClick={() =>
                        setConfirm({
                          title: "Remove this threat permanently?",
                          body: "Defender quarantine actions are one-way — this is not reversible.",
                          confirmLabel: "Remove",
                          run: () =>
                            call("security_remove_threat", { threat_id: t.id })
                              .then((r: any) => toast(r))
                              .catch((e) => toast(errorCopy(e), "err")),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Protection Hardening */}
      <Section title="Protection Hardening" subtitle="Controlled Folder Access (ransomware protection) and Attack Surface Reduction rules">
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--text-secondary)]">
            CFA:{" "}
            <span className="font-medium text-[var(--text-primary)]">{cfaMode}</span>
          </span>
          <div className="flex gap-1.5">
            <button
              className={`btn-ghost text-xs ${cfaMode === "audit" ? "!border-[var(--status-warning-border)] !bg-[var(--status-warning-bg)] !text-[var(--status-warning)]" : ""}`}
              onClick={() =>
                call("security_set_cfa_mode", { mode: "audit" })
                  .then(() => { setCfaMode("audit"); toast("CFA set to Audit Mode"); })
                  .catch((e) => toast(errorCopy(e), "err"))
              }
            >
              Audit
            </button>
            <button
              className={`btn-ghost text-xs ${cfaMode === "enabled" ? "!border-[var(--status-success-border)] !bg-[var(--status-success-bg)] !text-[var(--status-success)]" : ""}`}
              onClick={() =>
                call("security_set_cfa_mode", { mode: "enabled" })
                  .then(() => { setCfaMode("enabled"); toast("CFA enabled"); })
                  .catch((e) => toast(errorCopy(e), "err"))
              }
            >
              Enable
            </button>
            <button
              className="btn-ghost text-xs text-[var(--status-danger)]"
              onClick={() =>
                setConfirm({
                  title: "Disable Controlled Folder Access?",
                  body: "Disabling CFA weakens ransomware protection. Your files will no longer be shielded from unauthorized changes.",
                  confirmLabel: "Disable",
                  run: () =>
                    call("security_set_cfa_mode", { mode: "disabled" })
                      .then(() => { setCfaMode("disabled"); toast("CFA disabled"); })
                      .catch((e) => toast(errorCopy(e), "err")),
                })
              }
            >
              Disable
            </button>
          </div>
        </div>
        {asrError && <InlineAlert>{asrError}</InlineAlert>}
        {(asrRules ?? []).length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-xs font-medium text-[var(--text-tertiary)]">
              Attack Surface Reduction rules{" "}
              <span className="text-[var(--text-tertiary)]">(click to toggle audit/enable)</span>
            </div>
            {(asrRules ?? []).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-2"
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate text-xs text-[var(--text-secondary)]" title={r.name}>{r.name}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Action: {r.action}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    className={`btn-ghost text-2xs ${r.action === "audit" ? "!text-[var(--status-warning)]" : ""}`}
                    onClick={() =>
                      call("security_set_asr_rule_action", { rule_id: r.id, action: "audit" })
                        .then(() => { toast("ASR rule set to audit"); run(); })
                        .catch((e) => toast(errorCopy(e), "err"))
                    }
                  >
                    Audit
                  </button>
                  <button
                    className={`btn-ghost text-2xs ${r.action === "enabled" ? "!text-[var(--status-success)]" : ""}`}
                    onClick={() =>
                      call("security_set_asr_rule_action", { rule_id: r.id, action: "enabled" })
                        .then(() => { toast("ASR rule enabled"); run(); })
                        .catch((e) => toast(errorCopy(e), "err"))
                    }
                  >
                    Enable
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Privacy Audit */}
      <Section title="Privacy Audit" subtitle="Permissions, browser privacy & USB history">
        {permsError && <InlineAlert>{permsError}</InlineAlert>}
        {privacyError && <InlineAlert>{privacyError}</InlineAlert>}
        {usbError && <InlineAlert>{usbError}</InlineAlert>}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* App Permissions */}
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">App Permissions</div>
            <div className="space-y-2">
              {(perms ?? []).map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusDot status={p.allowed ? "success" : "warning"} />
                      <span className="text-sm font-medium text-[var(--text-primary)]">{p.label}</span>
                    </div>
                    <Toggle on={p.allowed} onChange={(v) => {
                      call("set_permission", { id: p.id, allowed: v })
                        .then(() => toast(`${p.label} access ${v ? "allowed" : "denied"}`))
                        .catch((e) => toast(errorCopy(e), "err"));
                    }} />
                  </div>
                  {p.apps.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {p.apps.map((a) => (
                        <div key={a.name} className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                          <StatusDot status={a.allowed ? "success" : "danger"} />
                          {a.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Browser Privacy */}
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">Browser Privacy</div>
            <div className="space-y-2">
              {(privacy ?? []).map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{p.label}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">
                        {p.browser} · {p.description}
                      </div>
                    </div>
                    <Toggle
                      on={p.enabled}
                      onChange={(v) => {
                        call("set_browser_policy", { browser: p.browser, policy: p.label, enabled: v })
                          .then(() => toast(`${p.label} → ${v ? "on" : "off"}`))
                          .catch((e) => toast(errorCopy(e), "err"));
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* USB History */}
            {!usbError && (usb ?? []).length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">USB Device History</div>
                <div className="space-y-1.5">
                  {(usb ?? []).map((u) => (
                    <div
                      key={u.vid + u.pid}
                      className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      <IconFingerprint size={12} className="text-[var(--text-tertiary)]" />
                      <span>{u.name}</span>
                      <span className="text-[var(--text-tertiary)]">
                        ({u.vid}:{u.pid})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Modal
        open={!!confirm}
        title={confirm?.title ?? ""}
        onClose={() => setConfirm(null)}
        onConfirm={() => { confirm?.run(); setConfirm(null); }}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        danger
      >
        <p>{confirm?.body}</p>
      </Modal>
    </div>
  );
}

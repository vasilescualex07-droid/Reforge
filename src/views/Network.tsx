import { useEffect, useState } from "react";
import { errorCopy, call } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { NetHog, NetResetResult, VpnConnection, WifiProfile } from "../lib/types";
import { InlineAlert, Modal, Section, StatusDot, toast } from "../components/ui";
import { IconRefresh, IconWifi, IconShield } from "../components/icons";

export default function Network() {
  const [vpnTarget, setVpnTarget] = useState<VpnConnection | null>(null);
  const [vpnConnect, setVpnConnect] = useState(false);
  const [forgetTarget, setForgetTarget] = useState<WifiProfile | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetResult, setResetResult] = useState<NetResetResult | null>(null);
  const [busy, setBusy] = useState(false);

  // S2.2/S2.3 — every primary load goes through useLoad with a real error
  // surface per section (never a dead blank or a fake "no profiles" message).
  const { data: hogs, error: hogsError, refresh: refreshHogs } = useLoad<NetHog[]>("get_bandwidth_hogs");
  const { data: wifi, error: wifiError, refresh: refreshWifi } = useLoad<WifiProfile[]>("list_wifi_profiles");
  const { data: vpn, error: vpnError, refresh: refreshVpn } = useLoad<VpnConnection[]>("list_vpn_connections");

  const refresh = () => {
    refreshHogs();
    refreshWifi();
    refreshVpn();
  };

  useEffect(refresh, [refreshHogs, refreshWifi, refreshVpn]);

  const toggleVpn = (v: VpnConnection) => {
    setVpnTarget(v);
    setVpnConnect(v.status !== "connected");
  };

  const actVpn = () => {
    if (!vpnTarget) return;
    const connecting = vpnConnect;
    call<VpnConnection[]>(connecting ? "vpn_connect" : "vpn_disconnect", { name: vpnTarget.name })
      .then(() => {
        refreshVpn();
        toast(connecting ? `Connected to ${vpnTarget.name}` : `Disconnected from ${vpnTarget.name}`);
        setVpnTarget(null);
      })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const forget = () => {
    if (!forgetTarget) return;
    call("forget_wifi_profile", { name: forgetTarget.name })
      .then((m) => { toast(m as string); setForgetTarget(null); refresh(); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const resetNetwork = () => {
    setBusy(true);
    call<NetResetResult>("reset_network")
      .then((r) => { setResetResult(r); toast("Network reset run — reboot may be needed"); refresh(); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setBusy(false));
  };

  const maxConns = Math.max(1, ...(hogs ?? []).map((h) => h.connections));

  return (
    <div className="space-y-5">
      <div className="page-head flex items-end justify-between">
        <div>
          <h1 className="page-title">Network</h1>
          <p className="page-subtitle">Who's eating your bandwidth, saved networks, resets</p>
        </div>
        <button className="btn-primary" onClick={refresh}>
          <IconRefresh size={14} /> Refresh
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Bandwidth hogs" subtitle="Active connections by process (live snapshot)">
          {hogsError && <InlineAlert>{hogsError}</InlineAlert>}
          <div className="space-y-2">
            {(hogs ?? []).map((h) => (
              <div key={h.pid} className="flex items-center gap-3">
                <div className="w-40 truncate text-sm text-[var(--text-secondary)]" title={h.name}>{h.name}</div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-active)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(h.connections / maxConns) * 100}%`,
                      background: "var(--gray-10)",
                    }}
                  />
                </div>
                <div className="w-14 text-right text-xs text-[var(--text-tertiary)]">
                  {h.connections} conn
                </div>
              </div>
            ))}
            {!hogsError && (hogs ?? []).length === 0 && (
              <p className="text-sm text-[var(--text-tertiary)]">No active connections to report right now.</p>
            )}
          </div>
        </Section>

        <Section title="Saved Wi-Fi networks" subtitle="Review and forget old networks — profiles are backed up first">
          {wifiError && <InlineAlert>{wifiError}</InlineAlert>}
          <div className="space-y-2">
            {(wifi ?? []).map((w) => (
              <div
                key={w.name}
                className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-2.5"
              >
                <IconWifi size={16} className="text-[var(--text-tertiary)]" />
                <div className="flex-1 text-sm text-[var(--text-primary)]">{w.name}</div>
                <button
                  className="btn-ghost btn-sm hover:!text-[var(--status-danger)]"
                  onClick={() => setForgetTarget(w)}
                >
                  Forget
                </button>
              </div>
            ))}
            {!wifiError && (wifi ?? []).length === 0 && (
              <p className="text-sm text-[var(--text-tertiary)]">No saved profiles detected.</p>
            )}
          </div>
          <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
            Forgetting a network removes its saved key. Reforge exports the profile XML first so it can be restored
            from History.
          </p>
        </Section>
      </div>

      <Section title="VPN connections" subtitle="Profiles from Windows VPN settings — connect or disconnect with one click">
        {vpnError && <InlineAlert>{vpnError}</InlineAlert>}
        <div className="space-y-2">
          {(vpn ?? []).map((v) => (
            <div
              key={v.name}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-2.5"
            >
              <IconShield size={16} className="text-[var(--text-tertiary)]" />
              <div className="flex-1">
                <div className="text-sm text-[var(--text-primary)]">{v.name}</div>
                <div className="text-2xs text-[var(--text-tertiary)]">
                  {v.server_address} · {v.type}
                </div>
              </div>
              <span
                className={`badge ${v.status === "connected" ? "badge-success" : "badge-neutral"}`}
              >
                <StatusDot status={v.status === "connected" ? "success" : "neutral"} pulse={v.status === "connecting"} />
                <span className="ml-1">{v.status}</span>
              </span>
              <button
                className={`btn-ghost btn-sm ${v.status === "connected" ? "hover:!text-[var(--status-danger)]" : ""}`}
                onClick={() => toggleVpn(v)}
              >
                {v.status === "connected" ? "Disconnect" : "Connect"}
              </button>
            </div>
          ))}
          {!vpnError && (vpn ?? []).length === 0 && (
            <p className="text-sm text-[var(--text-tertiary)]">
              No VPN profiles found — add one in Windows Settings → Network &amp; Internet → VPN.
            </p>
          )}
        </div>
        <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
          Read-only list; connecting/disconnecting is confirmed first and logged in History.
        </p>
      </Section>

      {/* Network Reset — Tier 2 (dangerous, needs confirmation) */}
      <Section
        title="One-click network reset"
        subtitle="Flush DNS, release/renew IP, reset Winsock + TCP/IP"
        actions={
          <button className="btn-danger btn-sm" disabled={busy} onClick={() => setResetOpen(true)}>
            Reset network…
          </button>
        }
      >
        {resetResult ? (
          <div className="space-y-1.5">
            {resetResult.steps.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <StatusDot status={s.ok ? "success" : "danger"} />
                <span className="flex-1 text-[var(--text-secondary)]">{s.name}</span>
                {!s.ok && <span className="text-xs text-[var(--status-danger)]">{s.detail}</span>}
              </div>
            ))}
            {resetResult.backup && (
              <div className="mt-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
                Adapter config backed up to{" "}
                <code className="text-[var(--text-secondary)]">{resetResult.backup.backup_dir}</code> — view the
                files if you need to restore static IPs manually.
              </div>
            )}
            <p className="pt-1 text-2xs text-[var(--text-tertiary)]">
              Some steps need an admin shell; a reboot may be required for full effect.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-tertiary)]">
            Use this when the internet misbehaves: DNS failures, dropped connections, or after a VPN glitch. Logged in
            History so you can see exactly what ran.
          </p>
        )}
      </Section>

      <Modal open={!!forgetTarget} title={`Forget "${forgetTarget?.name}"?`} onClose={() => setForgetTarget(null)} onConfirm={forget} confirmLabel="Forget network" danger>
        <p>
          The saved key for this network will be removed — Windows will no longer auto-connect. Reforge exports a
          backup profile first, so you can restore it from <b>History → Undo</b> if you change your mind.
        </p>
      </Modal>

      <Modal open={resetOpen} title="Reset your network?" onClose={() => setResetOpen(false)} onConfirm={resetNetwork} confirmLabel="Yes, reset it" danger>
        <p>
          This flushes the DNS cache, releases &amp; renews your IP lease, and resets the Winsock catalog and TCP/IP
          stack. Your internet will blip for a few seconds. Some steps may need an admin shell.
        </p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Before anything runs, Reforge backs up your current adapter config (IP assignments, DNS, routes) to disk so
          you can see exactly what changed.
        </p>
      </Modal>

      <Modal
        open={!!vpnTarget}
        title={vpnConnect ? `Connect to "${vpnTarget?.name}"?` : `Disconnect from "${vpnTarget?.name}"?`}
        onClose={() => setVpnTarget(null)}
        onConfirm={actVpn}
        confirmLabel={vpnConnect ? "Connect" : "Disconnect"}
      >
        <p>
          {vpnConnect
            ? "Windows will dial the VPN using your saved credentials. If the profile requires a password prompt, Windows will show it."
            : "Your traffic returns to the local network. The disconnect is logged in History."}
        </p>
      </Modal>
    </div>
  );
}

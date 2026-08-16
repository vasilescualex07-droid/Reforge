export interface ThemeState {
  accent_hex: string;
  mode: "dark" | "light";
  transparency: boolean;
  color_prevalence: boolean;
}

export interface MonitorInfo {
  id: string;
  wallpaper: string;
}

export interface WallpaperState {
  current: string;
  monitor_supported: boolean;
  monitors: MonitorInfo[];
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  mode: string;
  accent_hex: string;
  gradient: [string, string];
  category: string;
}

export interface JunkItem {
  id: string;
  label: string;
  path: string;
  size: number;
  file_count: number;
  admin_required: boolean;
}

export interface JunkScan {
  items: JunkItem[];
  total_bytes: number;
  scanned_at: number;
}

export interface CleanResult {
  freed_bytes: number;
  deleted_count: number;
  failed: string[];
  skipped_admin: string[];
}

export interface StartupEntry {
  name: string;
  command: string;
  location: string;
  enabled: boolean;
  impact: number;
  admin_required: boolean;
}

export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  free: number;
  free_pct: number;
}

export interface ProcInfo {
  name: string;
  mem_mb: number;
  cpu_pct: number;
}

export interface SystemInfo {
  cpu_name: string;
  cpu_count: number;
  cpu_usage_pct: number;
  ram_total: number;
  ram_used: number;
  ram_free_pct: number;
  os: string;
  host: string;
  disks: DiskInfo[];
  top_processes: ProcInfo[];
}

export interface ScorePart {
  label: string;
  points: number;
  max: number;
}

export interface HealthScore {
  score: number;
  disk_free_pct: number;
  ram_free_pct: number;
  startup_count: number;
  last_cleanup_ts: number | null;
  breakdown: ScorePart[];
}

export interface UndoEntry {
  id: string;
  ts: number;
  kind: string;
  description: string;
  revertible: boolean;
  undone: boolean;
  data: Record<string, unknown>;
}

export interface Snapshot {
  id: string;
  ts: number;
  state: Record<string, unknown>;
}

export interface BatteryInfo {
  on_ac: boolean;
  percent: number;
  charging: boolean;
}

export interface DiskSample {
  name: string;
  mount: string;
  total: number;
  free: number;
  free_pct: number;
}

export interface ProcSample {
  name: string;
  mem_mb: number;
  cpu_pct: number;
}

export interface PerfSnapshot {
  ts: number;
  cpu_usage_pct: number;
  ram_total: number;
  ram_used: number;
  ram_free_pct: number;
  process_count: number;
  uptime_secs: number;
  boot_time_ts: number;
  battery: BatteryInfo | null;
  disks: DiskSample[];
  top_processes: ProcSample[];
}

export interface DuplicateFile {
  path: string;
  modified: number;
}

export interface DuplicateGroup {
  id: string;
  name: string;
  size: number;
  files: DuplicateFile[];
}

export interface DuplicateScan {
  groups: DuplicateGroup[];
  total_wasted: number;
  scanned_bytes: number;
}

export interface FolderSize {
  name: string;
  path: string;
  size: number;
  file_count: number;
}

// ---- S14 storage liberation ----

export interface DriveRadar {
  label: string;
  mount: string;
  total: number;
  free: number;
  used: number;
  top_level: FolderSize[];
}

export interface BiggestFile {
  path: string;
  size: number;
  modified: number;
  category: string;
}

export interface StorageConfig {
  unused_days: number;
  unused_min_mb: number;
  safe_temp: boolean;
  safe_update_cache: boolean;
  safe_recycle_bin: boolean;
  safe_browser_caches: boolean;
  safe_installers: boolean;
  exclusions: string[];
  dry_run: boolean;
  auto_clean: "off" | "weekly" | "monthly";
}

export interface CleanNowItem {
  id: string;
  label: string;
  path: string;
  size: number;
  file_count: number;
  /** "permanent" = regenerable junk (confirm once, then deleted); "trash" = moved to the staging trash, undoable. */
  action: string;
  admin_required: boolean;
}

export interface UnusedFile {
  path: string;
  size: number;
  modified: number;
  days_old: number;
  category: string;
}

export interface RecycleBinState {
  size: number;
  empty: boolean;
}

export interface WindowsOldInfo {
  exists: boolean;
  size: number;
  note: string;
}

export interface SwapFileInfo {
  name: string;
  path: string;
  size: number;
  note: string;
}

export interface BigDupeGroup {
  id: string;
  wasted_bytes: number;
  file_count: number;
  sample_paths: string[];
}

export interface MoveOp {
  from: string;
  to: string;
}

export interface CursorValue {
  name: string;
  path: string;
}

export interface CursorState {
  scheme_source: string;
  cursors: CursorValue[];
}

export interface CursorScheme {
  id: string;
  name: string;
  description: string;
}

export interface AuditItem {
  id: string;
  title: string;
  status: "ok" | "warn" | "info";
  detail: string;
  action_hint: string;
}

export interface MaintenanceReport {
  ts: number;
  junk_bytes: number;
  junk_items: number;
  duplicate_bytes: number;
  duplicate_files: number;
  storage_top: FolderSize[];
  /** S11.4 — heavy startup entries (impact ≥ 7) caught by the audit. */
  startup_heavy: number;
  notes: string[];
}

export interface ProfileExport {
  app: string;
  format: number;
  generated_at: number;
  theme: Record<string, unknown>;
  wallpaper: string;
  undo_count: number;
}

// ---- Animated wallpaper engine ----

export interface SceneConfig {
  id: string;
  name: string;
  kind: string;
  mood: string;
  speed: number;
  density: number;
  colors: string[];
}

export interface EngineState {
  active: boolean;
  frozen: boolean;
  scene: SceneConfig | null;
  media: VideoWallpaper | null;
  static_wallpaper: string;
}

// ---- Widgets ----

export interface WidgetConfig {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  content: string;
  visible: boolean;
  /** Monitor index the widget lives on (S9.2 per-monitor layout). */
  monitor: number;
}

export interface WidgetsSettings {
  /** Hide widget windows while a fullscreen app/game has focus (S9.4). */
  autohide_fullscreen: boolean;
}

export interface WidgetStats {
  cpu: number;
  ram_pct: number;
  disk_free_pct: number;
  gpu_name: string | null;
  gpu_usage: number | null;
  net_up_kbps: number;
  net_down_kbps: number;
  thermal_c: number | null;
}

// ---- Tune-up extras ----

export interface BloatApp {
  name: string;
  publisher: string;
  uninstall_string: string;
  hive: string;
  subkey: string;
  size_mb: number | null;
}

export interface MemHog {
  name: string;
  pid: number;
  mem_mb: number;
  cpu_pct: number;
}

export interface OrphanEntry {
  name: string;
  hive: string;
  subkey: string;
  install_location: string;
  reason: string;
}

export interface PowerPlan {
  name: string;
  guid: string;
  active: boolean;
}

export interface TaskInfo {
  name: string;
  status: string;
  trigger: string;
  author: string;
  risky: boolean;
}

export interface BootStats {
  last_boot_ms: number | null;
  trend_ms: number | null;
  samples: number;
  available: boolean;
}

export interface ExtensionInfo {
  browser: string;
  name: string;
  version: string;
  enabled: boolean;
  source: string;
}

export interface AssociationInfo {
  ext: string;
  prog_id: string;
  handler: string;
}

export interface DriverInfo {
  name: string;
  provider: string;
  version: string;
  date: string;
}

// ---- Files / organize extras ----

export interface SmartFolder {
  id: string;
  name: string;
  root: string;
  extensions: string[];
  min_age_days: number | null;
  created_at: number;
}

export interface SmartHit {
  path: string;
  size: number;
  modified: number;
}

export interface ArchiveMove {
  rel: string;
  original: string;
}

export interface RenameOp {
  from: string;
  to: string;
}

export interface StaleDownload {
  path: string;
  size: number;
  modified: number;
  age_days: number;
}

export interface StaleApp {
  name: string;
  exe: string;
  last_modified: number;
  age_days: number;
}

export interface CloudDupGroup {
  name: string;
  size: number;
  paths: string[];
}

// ---- Security extras ----

export interface PermissionApp {
  name: string;
  allowed: boolean;
}

export interface PermissionState {
  id: string;
  label: string;
  allowed: boolean;
  apps: PermissionApp[];
}

export interface PrivacyPolicyItem {
  id: string;
  browser: string;
  label: string;
  enabled: boolean;
  description: string;
}

export interface UsbDevice {
  name: string;
  vid: string;
  pid: string;
  first_seen: number | null;
}

// ---- Productivity ----

export interface ClipItem {
  id: string;
  text: string;
  ts: number;
  pinned: boolean;
}

export interface AppEntry {
  name: string;
  path: string;
}

export interface MacroRule {
  id: string;
  name: string;
  when_app: string;
  look_name: string;
  accent: string;
  mode: string;
  wallpaper: string;
  enabled: boolean;
}

// ---- Network ----

export interface NetHog {
  name: string;
  pid: number;
  connections: number;
}

export interface WifiProfile {
  name: string;
  backed_up: boolean;
}

export interface NetResetStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface NetResetResult {
  steps: NetResetStep[];
  backup: NetResetBackup | null;
}

// ---- Gaming / displays ----

export interface StreamLayoutState {
  icons_hidden: boolean;
  taskbar_autohide: boolean;
}

export interface DisplayMonitorInfo {
  id: string;
  name: string;
  resolution: string;
  refresh: number;
  primary: boolean;
}

export interface DisplayProfile {
  id: string;
  name: string;
  created_at: number;
  monitors: { id: string; wallpaper: string }[];
}

// ---- Automation / perf / dashboard ----

/** The exact payload `apply_style` accepts — mirrors Rust `StyleApply`. */
export interface StyleApplyPayload {
  id: string;
  name: string;
  mode?: string;
  accent_hex?: string;
  transparency?: boolean;
  wallpaper?: string;
  wallpaper_type?: "static" | "live" | "scene";
  scene?: SceneConfig;
  font?: string;
  sound_scheme?: string;
  rgb?: "accent-sync" | "off";
}

/** S11.3 — one wall-clock style apply: at `time` the backend applies `payload`
 *  through the same `apply_style` path (revertible from History). */
export interface StyleScheduleEntry {
  id: string;
  time: string; // "HH:MM"
  style_id: string;
  name: string;
  payload: StyleApplyPayload;
  last_fired_day: string;
}

export interface AutomationConfig {
  weekly_junk: boolean;
  monthly_dupes: boolean;
  auto_reapply_theme: boolean;
  last_weekly_run: number;
  last_monthly_run: number;
  blue_light_on: boolean;
  blue_light_intensity: number;
  /** S11.1 — time-based blue light filter (10-min transition ramp). */
  blue_light_schedule: boolean;
  blue_light_start: string; // "HH:MM"
  blue_light_end: string; // "HH:MM"
  /** S11.3 — scheduled style applies. */
  style_schedule: StyleScheduleEntry[];
  /** S11.6 — config creation stamp; the first auto-run waits 24h (grace). */
  created_at: number;
}

export interface MaintenanceRun {
  ran_junk: boolean;
  junk_freed: number;
  ran_dupes: boolean;
  dupe_wasted: number;
  reapplied_theme: boolean;
  notes: string[];
}

export interface PerfRecord {
  ts: number;
  cpu_avg: number;
  cpu_max: number;
  ram_free_pct: number;
}

export interface BatteryHealth {
  available: boolean;
  design_mwh: number | null;
  full_mwh: number | null;
  health_pct: number | null;
  cycle_count: number | null;
}

export interface DashboardMetrics {
  personalization_score: number;
  storage_freed: number;
  files_organized: number;
  time_saved_secs: number;
  active_features: string[];
}

// ---- Marketplace / packs ----

export interface BundleComponentDef {
  type: string;
  hex?: string;
  mode?: string;
  asset?: string;
  scheme?: string;
  guid?: string;
  event?: string;
  size?: string;
  alignment?: string;
  autohide?: boolean;
  kind?: string;
  speed?: number;
  density?: number;
  colors?: string[];
  original?: string;
  substitute?: string;
}

export interface BundleManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  thumbnail: string;
  components: BundleComponentDef[];
}

export interface BundleInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  component_count: number;
  applied: boolean;
}

// ---- Network / VPN ----

export interface VpnConnection {
  name: string;
  server_address: string;
  status: string; // "connected" | "disconnected" | "connecting"
  type: string;
}

export interface NetResetBackup {
  backup_dir: string;
  files: string[];
}

// ---- Static wallpaper ----

export interface WallpaperHistoryEntry {
  ts: number;
  path: string;
  monitor_id: string | null;
}

export interface WallpaperSlideshowConfig {
  enabled: boolean;
  folder: string;
  interval_minutes: number;
  shuffle: boolean;
  next_rotation_ts: number | null;
  last_applied: string | null;
  /** S11.5 — favorite paths (inside `folder`): weighted 3× in the rotation. */
  favorites: string[];
  /** S11.5 — at night prefer night-named images, by day day-named ones. */
  day_night_filter: boolean;
}

export interface WallpaperCollection {
  name: string;
  count: number;
  items: { path: string; name: string }[];
}

// ---- Auto-updater (S12.1) ----

export interface UpdateConfig {
  /** https:// or file:// URL of the version manifest. */
  manifest_url: string;
  /** Default off — the app never phones home unless the user asks. */
  check_on_startup: boolean;
}

export interface UpdateCheck {
  state: "up-to-date" | "update-available" | "error";
  current: string;
  latest: string | null;
  url: string | null;
  sha256: string | null;
  notes: string[];
  message: string | null;
}

export interface StagedUpdate {
  version: string;
  path: string;
  bytes: number;
  downloaded_at: number;
}

// ---- Shell / taskbar ----

export interface TaskbarState {
  size: string;
  alignment: string;
  autohide: boolean;
  color_match: boolean;
}

export interface PendingShellState {
  pending: boolean;
  changes: string[];
  explorer_running: boolean;
}

// ---- Sounds ----

export interface SoundSchemeInfo {
  guid: string;
  name: string;
  current: boolean;
  builtin: boolean;
}

export interface SoundEventInfo {
  event: string;
  label: string;
  current: string;
  default: string;
  has_sound: boolean;
}

// ---- Fonts ----

export interface FontSubstitution {
  original: string;
  substituted: string;
}

export interface FontEntry {
  name: string;
  filename: string;
  source: string;
  substituted_to: string | null;
}

// ---- Lock screen ----

export interface LockScreenState {
  mode: string;
  image_path: string | null;
  slideshow_folder: string | null;
  slideshow_interval_secs: number | null;
  slideshow_shuffle: boolean | null;
  hide_apps: boolean | null;
}

// ---- Capability matrix ----

export interface CapabilityMatrix {
  os_name: string;
  build: number;
  version_band: string;
  is_win11: boolean;
  admin: boolean;
  secure_boot: boolean | null;
  taskbar_reposition_supported: boolean;
  font_substitution_supported: boolean;
  lockscreen_policy_supported: boolean;
  boot_customization_supported: boolean;
  rgb_supported: boolean;
  video_wallpaper_supported: boolean;
  ffmpeg_available: boolean;
  elevation_required_reason: string | null;
}

// ---- Video wallpaper / transcode ----

export interface VideoWallpaper {
  path: string;
  kind: string;
  width: number;
  height: number;
  name: string;
}

export interface TranscodeStatus {
  available: boolean;
  version: string | null;
  path: string | null;
  max_import_bytes: number;
  note: string;
}

export type TranscodePreset = "high" | "balanced" | "performance";

export interface TranscodeConfig {
  preset: TranscodePreset;
}

// ---- Screensaver (E4.6) ----

export interface ScreensaverConfig {
  enabled: boolean;
  timeout_secs: number;
  /** Which scene to show. None = the currently active engine scene. */
  scene: SceneConfig | null;
}

/** Registry truth — what Windows is actually set to (may differ from config if
 *  the user changed it in the system dialog). */
export interface ScreensaverRegistry {
  active: boolean;
  timeout_secs: number;
}

// ---- Power & battery (S10.1) ----

export interface LiveBattery {
  percent: number;
  on_ac: boolean;
  charging: boolean;
}

export interface BatteryHealth {
  health_pct: number | null;
  design_mwh: number | null;
  full_mwh: number | null;
  cycle_count: number | null;
}

export interface PowerPlan {
  guid: string;
  name: string;
  hint: string;
  active: boolean;
}

export interface PowerState {
  battery: LiveBattery | null;
  battery_health: BatteryHealth | null;
  plans: PowerPlan[];
  screen_off_ac_min: number;
  screen_off_dc_min: number;
  hibernate_enabled: boolean;
  hibernate_supported: boolean;
}

// ---- Gaming profiles (S10.3) ----

export interface GameProfile {
  id: string;
  exe: string;
  name: string;
  game_mode: boolean;
  scene_pause: boolean;
  priority: "normal" | "high";
  overlay: boolean;
}

// ---- Focus sessions (S10.6) ----

export interface FocusSession {
  active: boolean;
  ends_at_ts: number;
  minutes: number;
  dnd_on: boolean;
}

// ---- Accessibility (S10.7) ----

export interface ColorFilterState {
  active: boolean;
  /** 0 grayscale · 1 invert · 2 grayscale inverted · 3-5 color blindness */
  filter_type: number;
}

export interface AccessibilityState {
  high_contrast: boolean;
  animations_off: boolean;
  cursor_size: number;
  text_scale_pct: number;
  color_filter: ColorFilterState;
}

/** Mirrors the Rust AppError tagged union (src-tauri/src/error.rs) so the
 *  frontend can branch on error SHAPE, not message text (Standard B §6/§7).
 *  The backend serializes errors as { kind, message } via serde's tag mode. */
export interface BuildInfo {
  build_ts: number | null;
  git_hash: string | null;
  exe_path: string | null;
}

export type AppErrorKind = "Io" | "Registry" | "Command" | "NotFound" | "Invalid";

export interface AppErrorShape {
  kind: AppErrorKind;
  message: string;
}

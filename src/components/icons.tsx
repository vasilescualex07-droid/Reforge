import {
  Home, Palette, ShoppingBag, Wrench, FolderOpen,
  Shield, Clock, Settings, Zap, Monitor, Globe, Gamepad2,
  Search, Plus, Download, Upload,
  Trash2, X, Check, AlertTriangle, Info, Star, Eye, EyeOff,
  Play, Pause, Square, RefreshCw, Copy, Pin, FileText,
  Calendar, Clipboard, MousePointer, Layout, Volume2,
  Type, Lock, Image, Film, Sparkles, Cpu, HardDrive, Battery,
  Wifi, ShieldCheck, ShieldAlert, ShieldX, Scan, Bug,
  ChevronDown, ChevronUp, ChevronRight, ArrowRight, ExternalLink,
  Bell, Maximize, Minimize, RotateCcw,
  MoreHorizontal, Layers, Crosshair, Gauge, Network, Server,
  Moon, Sun, Database, Archive, Lightbulb,
  Pipette, Circle, Power,
  Terminal, Hash, List, Grid, Filter, SortAsc,
  Undo2, Timer, StopCircle, Radio,
  Keyboard, Pointer,
  Folder, File, FileImage, FileVideo, FileAudio,
  BarChart3, Activity, TrendingUp, TrendingDown,
  Fingerprint,
} from "lucide-react";

type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
};

// ---- Navigation ----
export const NavDashboard = (p: IconProps) => <Home {...p} />;
export const NavMakeover = (p: IconProps) => <Palette {...p} />;
export const NavMarketplace = (p: IconProps) => <ShoppingBag {...p} />;
export const NavPerformance = (p: IconProps) => <Activity {...p} />;
export const NavTuneup = (p: IconProps) => <Wrench {...p} />;
export const NavOrganize = (p: IconProps) => <FolderOpen {...p} />;
export const NavSecurity = (p: IconProps) => <Shield {...p} />;
export const NavProductivity = (p: IconProps) => <Zap {...p} />;
export const NavDisplays = (p: IconProps) => <Monitor {...p} />;
export const NavNetwork = (p: IconProps) => <Globe {...p} />;
export const NavGaming = (p: IconProps) => <Gamepad2 {...p} />;
export const NavPower = (p: IconProps) => <Battery {...p} />;
export const NavAccess = (p: IconProps) => <Eye {...p} />;
export const NavHistory = (p: IconProps) => <Clock {...p} />;
export const NavSettings = (p: IconProps) => <Settings {...p} />;

// ---- Actions ----
export const IconSearch = (p: IconProps) => <Search {...p} />;
export const IconPlus = (p: IconProps) => <Plus {...p} />;
export const IconRefresh = (p: IconProps) => <RefreshCw {...p} />;
export const IconDownload = (p: IconProps) => <Download {...p} />;
export const IconUpload = (p: IconProps) => <Upload {...p} />;
export const IconTrash = (p: IconProps) => <Trash2 {...p} />;
export const IconClose = (p: IconProps) => <X {...p} />;
export const IconCheck = (p: IconProps) => <Check {...p} />;
export const IconUndo = (p: IconProps) => <Undo2 {...p} />;
export const IconCopy = (p: IconProps) => <Copy {...p} />;
export const IconPin = (p: IconProps) => <Pin {...p} />;

// ---- Media ----
export const IconPlay = (p: IconProps) => <Play {...p} />;
export const IconPause = (p: IconProps) => <Pause {...p} />;
export const IconStop = (p: IconProps) => <Square {...p} />;
export const IconVolume = (p: IconProps) => <Volume2 {...p} />;

// ---- Status ----
export const IconSuccess = (p: IconProps) => <Check {...p} />;
export const IconWarning = (p: IconProps) => <AlertTriangle {...p} />;
export const IconDanger = (p: IconProps) => <X {...p} />;
export const IconInfo = (p: IconProps) => <Info {...p} />;

// ---- Features ----
export const IconPalette = (p: IconProps) => <Palette {...p} />;
export const IconImage = (p: IconProps) => <Image {...p} />;
export const IconFilm = (p: IconProps) => <Film {...p} />;
export const IconSparkles = (p: IconProps) => <Sparkles {...p} />;
export const IconCpu = (p: IconProps) => <Cpu {...p} />;
export const IconHardDrive = (p: IconProps) => <HardDrive {...p} />;
export const IconBattery = (p: IconProps) => <Battery {...p} />;
export const IconWifi = (p: IconProps) => <Wifi {...p} />;
export const IconLock = (p: IconProps) => <Lock {...p} />;
export const IconType = (p: IconProps) => <Type {...p} />;
export const IconLayout = (p: IconProps) => <Layout {...p} />;
export const IconCalendar = (p: IconProps) => <Calendar {...p} />;
export const IconFileText = (p: IconProps) => <FileText {...p} />;
export const IconClipboard = (p: IconProps) => <Clipboard {...p} />;
export const IconMouse = (p: IconProps) => <MousePointer {...p} />;
export const IconKeyboard = (p: IconProps) => <Keyboard {...p} />;

// ---- Security ----
export const IconShield = (p: IconProps) => <Shield {...p} />;
export const IconShieldCheck = (p: IconProps) => <ShieldCheck {...p} />;
export const IconShieldAlert = (p: IconProps) => <ShieldAlert {...p} />;
export const IconShieldX = (p: IconProps) => <ShieldX {...p} />;
export const IconScan = (p: IconProps) => <Scan {...p} />;
export const IconBug = (p: IconProps) => <Bug {...p} />;
export const IconFingerprint = (p: IconProps) => <Fingerprint {...p} />;

// ---- UI ----
export const IconChevronDown = (p: IconProps) => <ChevronDown {...p} />;
export const IconChevronUp = (p: IconProps) => <ChevronUp {...p} />;
export const IconChevronRight = (p: IconProps) => <ChevronRight {...p} />;
export const IconArrowRight = (p: IconProps) => <ArrowRight {...p} />;
export const IconExternalLink = (p: IconProps) => <ExternalLink {...p} />;
export const IconMore = (p: IconProps) => <MoreHorizontal {...p} />;
export const IconEye = (p: IconProps) => <Eye {...p} />;
export const IconEyeOff = (p: IconProps) => <EyeOff {...p} />;
export const IconStar = (p: IconProps) => <Star {...p} />;
export const IconCircle = (p: IconProps) => <Circle {...p} />;
export const IconPower = (p: IconProps) => <Power {...p} />;

// ---- Theme ----
export const IconMoon = (p: IconProps) => <Moon {...p} />;
export const IconSun = (p: IconProps) => <Sun {...p} />;
export const IconPipette = (p: IconProps) => <Pipette {...p} />;

// ---- Files ----
export const IconFolder = (p: IconProps) => <Folder {...p} />;
export const IconFile = (p: IconProps) => <File {...p} />;
export const IconFileImage = (p: IconProps) => <FileImage {...p} />;
export const IconFileVideo = (p: IconProps) => <FileVideo {...p} />;
export const IconFileAudio = (p: IconProps) => <FileAudio {...p} />;
export const IconArchive = (p: IconProps) => <Archive {...p} />;

// ---- Charts ----
export const IconBarChart = (p: IconProps) => <BarChart3 {...p} />;
export const IconGauge = (p: IconProps) => <Gauge {...p} />;
export const IconTrendingUp = (p: IconProps) => <TrendingUp {...p} />;
export const IconTrendingDown = (p: IconProps) => <TrendingDown {...p} />;

// ---- Misc ----
export const IconLayers = (p: IconProps) => <Layers {...p} />;
export const IconLightbulb = (p: IconProps) => <Lightbulb {...p} />;
export const IconTerminal = (p: IconProps) => <Terminal {...p} />;
export const IconHash = (p: IconProps) => <Hash {...p} />;
export const IconList = (p: IconProps) => <List {...p} />;
export const IconGrid = (p: IconProps) => <Grid {...p} />;
export const IconFilter = (p: IconProps) => <Filter {...p} />;
export const IconSort = (p: IconProps) => <SortAsc {...p} />;
export const IconTimer = (p: IconProps) => <Timer {...p} />;
export const IconStopCircle = (p: IconProps) => <StopCircle {...p} />;
export const IconRadio = (p: IconProps) => <Radio {...p} />;
export const IconDatabase = (p: IconProps) => <Database {...p} />;
export const IconServer = (p: IconProps) => <Server {...p} />;
export const IconNetwork = (p: IconProps) => <Network {...p} />;
export const IconCrosshair = (p: IconProps) => <Crosshair {...p} />;
export const IconClock = (p: IconProps) => <Clock {...p} />;
export const IconPointer = (p: IconProps) => <Pointer {...p} />;
export const IconMonitor = (p: IconProps) => <Monitor {...p} />;
export const IconGamepad = (p: IconProps) => <Gamepad2 {...p} />;
export const IconGamepad2 = (p: IconProps) => <Gamepad2 {...p} />;
export const IconBell = (p: IconProps) => <Bell {...p} />;
export const IconMaximize = (p: IconProps) => <Maximize {...p} />;
export const IconMinimize = (p: IconProps) => <Minimize {...p} />;
export const IconRotateCcw = (p: IconProps) => <RotateCcw {...p} />;

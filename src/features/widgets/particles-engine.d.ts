// Type declarations for particles-engine.js (UMD, also embedded in overlays).
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  shape: "circle" | "rect" | "ribbon" | "shard" | "sprite";
  color: string;
  rot: number;
  vrot: number;
  alpha?: number;
  img?: HTMLCanvasElement | HTMLImageElement;
}

export interface Engine {
  spawn(p: Partial<Particle>): Particle;
  update(dt: number): void;
  draw(): void;
  step(dt: number): void;
  count(): number;
  clear(): void;
  destroy(): void;
  resize(): void;
  particles: Particle[];
}

export function createEngine(
  canvas: HTMLCanvasElement,
  cfg?: { gravity?: number; drag?: number }
): Engine;

export function burstConfetti(
  engine: Engine,
  opts?: {
    x?: number;
    y?: number;
    count?: number;
    colors?: string[];
    angle0?: number;
    spread?: number;
    speed0?: number;
    speed1?: number;
    life?: number;
  }
): void;

// Type declarations for audio-gen.js (UMD, also embedded in overlays via ?raw).
declare const RFAudio: {
  pop(ctx: AudioContext, dest: AudioNode, o?: { gain?: number }): void;
  whoosh(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; dur?: number }): void;
  shatter(ctx: AudioContext, dest: AudioNode, o?: { gain?: number }): void;
  sting(ctx: AudioContext, dest: AudioNode, o?: { gain?: number }): void;
  chime(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; notes?: number[] }): void;
  siren(
    ctx: AudioContext,
    dest: AudioNode,
    o?: { gain?: number; speed?: number; depth?: number }
  ): { stop: (fadeMs?: number) => void };
  glitch(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; dur?: number }): void;
  flourish(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; notes?: number[] }): void;
  comedy(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; f0?: number; f1?: number }): void;
  chirp(ctx: AudioContext, dest: AudioNode, o?: { gain?: number; f?: number }): void;
  step(ctx: AudioContext, dest: AudioNode, o?: { gain?: number }): void;
  unlock(ctx: AudioContext): void;
  noise(ctx: AudioContext): AudioBuffer;
};
export default RFAudio;

/*
 * Reforge Widgets — shared audio generator library (spec §3 AUDIO MANAGER).
 *
 * Every sound in the widget system is synthesized here with Web Audio (no
 * asset files): pop/whoosh (confetti), glass shatter (rage), error sting
 * (BSOD), unlock chime (achievements), cartoon siren (CPU fire), glitch
 * stinger, certificate flourish, comedic stings (roast / keyboard smash),
 * pet chirps + footsteps.
 *
 * Single source of truth: this file is UMD so it can be imported as a module
 * by the main window (audio.ts) AND embedded verbatim into overlay HTML via
 * `?raw` (overlay windows are separate webviews that can't import app code).
 * Each generator takes (ctx, dest, opts) — the caller owns the AudioContext
 * and the destination GainNode, so layering is just wiring separate gains.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RFAudio = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var noiseBuf = null;
  function noise(ctx) {
    if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
      var len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function now(ctx) {
    return ctx.currentTime;
  }

  // Generic ADSR-ish helper: schedule an exponential ramp to `peak` then decay.
  function envGain(ctx, dest, peak, attack, decay, t0) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(dest);
    return g;
  }

  /** Light pop — confetti launch, toggle clicks. */
  function pop(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(340, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.12);
    var g = envGain(ctx, dest, o.gain || 0.22, 0.008, 0.14, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  /** Airy whoosh — confetti burst / whip swish layer. */
  function whoosh(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var dur = o.dur || 0.35;
    var src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(220, t0);
    f.frequency.exponentialRampToValueAtTime(2600, t0 + dur);
    var g = envGain(ctx, dest, o.gain || 0.16, 0.04, dur, t0);
    src.connect(f);
    f.connect(g);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  /** Glass shatter — rage shatter fracture start. Noise burst + metallic pings. */
  function shatter(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    var hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1600;
    var g = envGain(ctx, dest, o.gain || 0.45, 0.005, 0.35, t0);
    src.connect(hp);
    hp.connect(g);
    src.start(t0);
    src.stop(t0 + 0.45);
    for (var i = 0; i < 6; i++) {
      var osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1800 + Math.random() * 4200;
      var og = envGain(ctx, dest, 0.018, 0.002, 0.1, t0 + 0.01 + i * 0.03);
      osc.connect(og);
      osc.start(t0 + 0.01 + i * 0.03);
      osc.stop(t0 + 0.15 + i * 0.03);
    }
  }

  /** Harsh error sting — fake BSOD appear. Saw drop + sub boom. */
  function sting(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.6);
    var g = envGain(ctx, dest, o.gain || 0.18, 0.01, 0.55, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.65);
    var sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 70;
    var sg = envGain(ctx, dest, o.gain || 0.2, 0.01, 0.8, t0);
    sub.connect(sg);
    sub.start(t0);
    sub.stop(t0 + 0.9);
  }

  /** Cheerful unlock chime — achievement popper. Two ascending notes. */
  function chime(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var notes = o.notes || [523.25, 659.25, 783.99]; // C5 E5 G5
    for (var i = 0; i < notes.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = notes[i];
      var g = envGain(ctx, dest, (o.gain || 0.16) * (1 - i * 0.2), 0.01, 0.35, t0 + i * 0.09);
      osc.connect(g);
      osc.start(t0 + i * 0.09);
      osc.stop(t0 + i * 0.09 + 0.5);
    }
  }

  /**
   * Cartoon siren loop — CPU fire alarm. Returns { stop } so the caller can
   * fade the loop out when usage drops. Two alternating tones for the
   * classic European police-siren feel.
   */
  function siren(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var osc = ctx.createOscillator();
    osc.type = "square";
    var g = ctx.createGain();
    g.gain.setValueAtTime(o.gain || 0.05, t0);
    var lfo = ctx.createOscillator();
    lfo.frequency.value = o.speed || 0.8;
    var lg = ctx.createGain();
    lg.gain.value = o.depth || 260;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    lfo.start(t0);
    return {
      stop: function (fadeMs) {
        fadeMs = fadeMs || 400;
        var t1 = now(ctx);
        try {
          g.gain.cancelScheduledValues(t1);
        } catch (e) {
          /* no-op */
        }
        g.gain.setValueAtTime(g.gain.value || 0.05, t1);
        g.gain.linearRampToValueAtTime(0.0001, t1 + fadeMs / 1000);
        var t2 = t1 + fadeMs / 1000 + 0.05;
        osc.stop(t2);
        lfo.stop(t2);
      },
    };
  }

  /** Quick static/glitch stinger — glitch jumpscare. */
  function glitch(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var dur = o.dur || 0.3;
    for (var i = 0; i < 8; i++) {
      var src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      var f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 600 + Math.random() * 2400;
      f.Q.value = 8;
      var g = envGain(ctx, dest, (o.gain || 0.14) * (1 - i * 0.08), 0.002, 0.03, t0 + i * (dur / 8));
      src.connect(f);
      f.connect(g);
      src.start(t0 + i * (dur / 8));
      src.stop(t0 + (i + 1) * (dur / 8));
    }
  }

  /** Light flourish — certificate generation. Short major arpeggio. */
  function flourish(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var notes = o.notes || [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < notes.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = notes[i];
      var g = envGain(ctx, dest, (o.gain || 0.14) * (1 - i * 0.15), 0.012, 0.3, t0 + i * 0.07);
      osc.connect(g);
      osc.start(t0 + i * 0.07);
      osc.stop(t0 + i * 0.07 + 0.45);
    }
  }

  /** Comedic "wah wah" descending two-tone — idle roast / keyboard smash. */
  function comedy(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var f0 = o.f0 || 392; // G4
    var f1 = o.f1 || 233; // Bb3
    for (var i = 0; i < 2; i++) {
      var osc = ctx.createOscillator();
      osc.type = "triangle";
      var f = i === 0 ? f0 : f1;
      osc.frequency.setValueAtTime(f, t0 + i * 0.22);
      osc.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + i * 0.22 + 0.18);
      var g = envGain(ctx, dest, (o.gain || 0.16) * (1 - i * 0.3), 0.012, 0.2, t0 + i * 0.22);
      osc.connect(g);
      osc.start(t0 + i * 0.22);
      osc.stop(t0 + i * 0.22 + 0.3);
    }
  }

  /** Tiny chirp — desktop pet. */
  function chirp(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.f || 900, t0);
    osc.frequency.exponentialRampToValueAtTime((o.f || 900) * 1.4, t0 + 0.05);
    osc.frequency.exponentialRampToValueAtTime((o.f || 900) * 0.8, t0 + 0.12);
    var g = envGain(ctx, dest, o.gain || 0.07, 0.01, 0.12, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  /** Soft footstep thud — desktop pet wandering. */
  function step(ctx, dest, o) {
    o = o || {};
    var t0 = now(ctx);
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.08);
    var g = envGain(ctx, dest, o.gain || 0.05, 0.004, 0.09, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  /** Unlock / resume a suspended AudioContext (call on user gesture). */
  function unlock(ctx) {
    if (ctx && ctx.state === "suspended") {
      try {
        ctx.resume();
      } catch (e) {
        /* ignore */
      }
    }
  }

  return {
    pop: pop,
    whoosh: whoosh,
    shatter: shatter,
    sting: sting,
    chime: chime,
    siren: siren,
    glitch: glitch,
    flourish: flourish,
    comedy: comedy,
    chirp: chirp,
    step: step,
    unlock: unlock,
    noise: noise,
  };
});

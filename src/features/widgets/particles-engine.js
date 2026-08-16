/*
 * Reforge Widgets — shared 2D particle engine (spec §3 PARTICLE ENGINE).
 *
 * One generic particle system (position, velocity, gravity, drag, rotation,
 * lifespan, color/shape) parametrized per use. It powers BOTH the Confetti
 * Cannon (rect/ribbon shapes, upward burst) and Rage Shatter's shard debris
 * (jagged polygon shards with per-shard polygons) — never two systems.
 *
 * UMD so the main window can import it as a module (unit tests) and overlay
 * windows can embed it verbatim via `?raw`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RFParticles = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * createEngine(canvas, cfg) → { spawn, update, draw, step, count, clear, destroy }
   *   cfg.gravity  px/s² downward (default 900)
   *   cfg.drag     per-second velocity multiplier (default 0.40 → strong air drag)
   */
  function createEngine(canvas, cfg) {
    cfg = cfg || {};
    var ctx = canvas.getContext("2d");
    var particles = [];
    var gravity = cfg.gravity != null ? cfg.gravity : 900;
    var dragPerSec = cfg.drag != null ? cfg.drag : 0.4;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

    function resize() {
      var w = canvas.clientWidth || canvas.width / dpr;
      var h = canvas.clientHeight || canvas.height / dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    if (typeof window !== "undefined") window.addEventListener("resize", resize);

    function spawn(p) {
      p.x = p.x != null ? p.x : 0;
      p.y = p.y != null ? p.y : 0;
      p.vx = p.vx || 0;
      p.vy = p.vy || 0;
      p.life = p.life || 1;
      p.maxLife = p.maxLife || p.life;
      p.size = p.size || 4;
      p.shape = p.shape || "circle";
      p.color = p.color || "#ffffff";
      p.rot = p.rot != null ? p.rot : Math.random() * Math.PI * 2;
      p.vrot = p.vrot != null ? p.vrot : (Math.random() - 0.5) * 12;
      p.drag = p.drag != null ? p.drag : 1;
      // Precompute a jagged polygon once for shards (never per frame — that
      // would flicker the silhouette and burn CPU).
      if (p.shape === "shard") {
        var n = 6 + ((Math.random() * 4) | 0);
        p.poly = [];
        for (var k = 0; k < n; k++) {
          var a = (k / n) * Math.PI * 2;
          var r = 0.55 + Math.random() * 0.6;
          p.poly.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
      }
      particles.push(p);
      return p;
    }

    function update(dt) {
      var dragMul = Math.pow(Math.max(0, 1 - dragPerSec), dt);
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += gravity * dt;
        var pd = p.drag === 1 ? dragMul : Math.pow(Math.max(0, 1 - p.drag), dt);
        p.vx *= pd;
        p.vy *= pd;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        p.vrot *= Math.pow(0.985, dt * 60);
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var t = Math.max(0, Math.min(1, p.life / p.maxLife));
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, p.size * (0.4 + 0.6 * t)), 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "rect" || p.shape === "ribbon") {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          var w = p.size;
          var h2 = p.shape === "ribbon" ? p.size * 0.32 : p.size * 0.7;
          ctx.fillRect(-w / 2, -h2 / 2, w, h2);
          ctx.restore();
        } else if (p.shape === "shard" && p.poly) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = t * (p.alpha != null ? p.alpha : 1);
          ctx.beginPath();
          for (var k = 0; k < p.poly.length; k++) {
            var pt = p.poly[k];
            var rx = pt[0] * p.size;
            var ry = pt[1] * p.size;
            if (k === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.shape === "sprite" && p.img) {
          // Image shards (Rage Shatter): the capture crop drawn as a particle,
          // so it can fall/rotate/fade under the same physics as everything else.
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = t * (p.alpha != null ? p.alpha : 1);
          var iw = p.img.width;
          var ih = p.img.height;
          var sc = (p.size * 2) / Math.max(1, Math.max(iw, ih));
          ctx.drawImage(p.img, (-iw * sc) / 2, (-ih * sc) / 2, iw * sc, ih * sc);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }

    function step(dt) {
      update(dt);
      draw();
    }

    return {
      spawn: spawn,
      update: update,
      draw: draw,
      step: step,
      count: function () {
        return particles.length;
      },
      clear: function () {
        particles.length = 0;
      },
      destroy: function () {
        if (typeof window !== "undefined") window.removeEventListener("resize", resize);
        particles.length = 0;
      },
      resize: resize,
      get particles() {
        return particles;
      },
    };
  }

  /**
   * burstConfetti(engine, opts) — the canonical confetti launch:
   *   x, y        origin (default: center-top-ish)
   *   count       particles
   *   angle0/angle1, speed0/speed1   launch cone (upward/outward burst)
   *   colors      palette (varied bright colors)
   *   life        seconds
   */
  function burstConfetti(engine, opts) {
    opts = opts || {};
    var cx = opts.x != null ? opts.x : (typeof window !== "undefined" ? window.innerWidth / 2 : 400);
    var cy = opts.y != null ? opts.y : (typeof window !== "undefined" ? window.innerHeight * 0.45 : 300);
    var n = opts.count || 150;
    var colors =
      opts.colors ||
      ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#fde68a", "#ffffff"];
    var a0 = opts.angle0 != null ? opts.angle0 : -Math.PI / 2;
    var spread = opts.spread != null ? opts.spread : 1.7;
    var s0 = opts.speed0 != null ? opts.speed0 : 260;
    var s1 = opts.speed1 != null ? opts.speed1 : 620;
    for (var i = 0; i < n; i++) {
      var ang = a0 + (Math.random() - 0.5) * spread;
      var speed = s0 + Math.random() * (s1 - s0);
      var roll = Math.random();
      engine.spawn({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        size: 5 + Math.random() * 8,
        color: colors[(Math.random() * colors.length) | 0],
        shape: roll < 0.55 ? "rect" : "ribbon",
        life: (opts.life || 3) + Math.random() * 1.4,
        maxLife: 4.5,
        vrot: (Math.random() - 0.5) * 14,
      });
    }
  }

  return { createEngine: createEngine, burstConfetti: burstConfetti };
});

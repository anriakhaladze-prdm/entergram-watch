/* ==========================================================================
   Shared back-office sign-in - the rippling dot field

   PORTABLE. Pairs with signin.css; between them they are the whole screen.
   No app-specific values, no dependencies, no globals beyond one IIFE.

   WHAT IT DRAWS
   A 32px grid of 3px dots over the whole viewport. Two slow radial waves cross
   the grid from different origins at different speeds; a dot's phase depends on
   where it sits, which is what makes the bright band travel outward as a ripple
   instead of the whole field pulsing at once. Each dot also carries a small
   stable random phase and a stable weight, so the lit dots read as scattered
   the way the reference does rather than as clean concentric rings, and so the
   same dots are never the bright ones twice.

   Colour is interpolated in OKLAB, not sRGB. The system is explicit about this
   (§4.3): mixing mint toward a neutral in sRGB turns it olive through the
   midtones, which is exactly the range most of these dots spend their time in.
   The endpoints are read out of CSS at start-up, so the field follows the theme
   and follows --sg-accent without a second source of truth.

   WHY CANVAS
   Roughly 1,400 dots at a 1600x900 viewport. One canvas redraws them in well
   under a millisecond; 1,400 DOM nodes each running their own keyframe with
   their own delay is how a login screen ends up dropping frames on a laptop.

   HOW THE MOTION IS BUILT
   Two things ride the same wave on different curves. Every dot's opacity
   breathes with it, linearly, so the whole field is always alive; only a few
   dots, picked by a skewed per-dot weight and a steep gamma, climb far enough
   to take on any mint. Driving both from one steep curve is what made the
   first version look frozen - a dot that was not firing did not move at all,
   and that was most of the field at any instant.

   COSTS IT REFUSES TO PAY
   - 30fps, not 60. The slowest wave takes 11 seconds to cycle; nobody can see
     the difference, and it halves the work.
   - Nothing at all while the tab is hidden.
   - Under prefers-reduced-motion the colour still cross-fades, at half
     amplitude and half speed, because nothing here MOVES: the dots never
     change position, so there is no vestibular trigger to remove. What that
     setting is asking for is calm, not a frozen image, and a frozen image is
     also indistinguishable from a broken script.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.querySelector('.sg-root');
  var canvas = document.querySelector('.sg-field');
  if (!root || !canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');

  /* ---- geometry ------------------------------------------------------- */

  var SPACING = 28;   // off-scale on purpose: see the note below
  /* The spacing scale steps 24 -> 32 and the reference measures 26-27. 32 read
     looser than the reference, 24 read busy. 28 is an arbitrary value, which
     §"Adapting to new surfaces" allows where the system has no step, provided
     it is called out. This is the one number on this screen that is not a
     token or on the scale. */
  var DOT     = 3;    // dot side in CSS px
  /* Knobs, all measured against the reference rather than guessed. The
     reference field is 1320 dots with 61 of them visibly mint (1 in 22), about
     6 of those near full strength, resting dots between base-8/11% and
     base-8/15%, and midtones around #477e6c.

       GAMMA        how sharply a dot peaks once the crest reaches it. Raising
                    it thins the lit crowd, but by dimming everything, so it is
                    the wrong knob for density on its own.
       WEIGHT_SKEW  how few dots ever get bright at all. This is the density
                    knob: it thins the crowd while the few that do fire still
                    reach full strength.
       HUE_DELAY    how late the neutral turns mint. Must be above 1. Below 1
                    the curve pulls up instead of down and the entire field
                    reads green - measured at 0.7, which put a dot at 10%
                    intensity a fifth of the way to the accent.
       PEAK         the intensity treated as fully lit. pow(v,GAMMA)*weight
                    tops out well below 1 in practice (it needs a heavy dot
                    sitting on both crests at once), so without this the ramp's
                    mint end is unreachable and every dot comes out sage.
       BREATH       how much of a dot's RESTING opacity swings with the wave.
                    This is the knob that decides whether the field looks
                    alive, and leaving it at 0 is what made the first version
                    read as a static grid with a few green dots on it: alpha
                    and hue were both driven by the same sharply-gamma'd
                    value, so a dot that was not firing did not move at all,
                    and at GAMMA 4 that is about 95% of them at any instant.
                    Now the hue still fires rarely and sharply while every dot
                    breathes gently, which is the reference's look and is also
                    the only version you can actually see moving. */
  var GAMMA       = 2.4;
  var WEIGHT_SKEW = 3.6;
  var HUE_DELAY   = 1.15;
  var PEAK        = 1.0;
  var BREATH      = 1.2;
  var FPS         = 30;

  /* Travelling waves. `at` is an origin in viewport fractions, `period` is
     seconds for a full cycle, `wave` is the distance in px between crests.

     Both numbers were far too large to see. At a 2600px wavelength across a
     1600px viewport the spatial phase varies by under 4 radians edge to edge,
     which the per-dot random scatter then swamps, so there was no travelling
     front left to watch; and at a 16 second period a dot moves through 0.4
     radians in a second, which is under the just-noticeable step for a dot
     that dim. Measured: 9% of the field changed visibly in a second, i.e.
     static to anybody who is not staring at it.

     A wavelength near the viewport width puts about one crest on screen at a
     time, which is what makes the brightening read as a band crossing the
     field rather than as random twinkle. */
  var WAVES = [
    { at: [0.50, -0.18], period: 7.5, wave: 800 },
    { at: [0.15,  1.12], period: 11.0, wave: 1100 }
  ];

  var TAU = Math.PI * 2;

  /* ---- colour: sRGB <-> OKLAB ----------------------------------------- */

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    var v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  function rgbToOklab(rgb) {
    var r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  function oklabToRgb(lab) {
    var L = lab[0], A = lab[1], B = lab[2];
    var l = L + 0.3963377774 * A + 0.2158037573 * B;
    var m = L - 0.1055613458 * A - 0.0638541728 * B;
    var s = L - 0.0894841775 * A - 1.2914855480 * B;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [
      linearToSrgb( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    ];
  }

  // Resolve any CSS colour expression - a var() chain, a color-mix(), a bare
  // hex - to sRGB bytes, by letting the browser do it twice: once through a
  // element's computed `color`, then once through a 1x1 canvas. No parsing, so
  // nothing to get wrong when a value comes back as oklab() or color(srgb ...).
  var probeEl = document.createElement('span');
  probeEl.style.display = 'none';
  document.body.appendChild(probeEl);
  var probeCv = document.createElement('canvas');
  probeCv.width = probeCv.height = 1;
  var probeCtx = probeCv.getContext('2d', { willReadFrequently: true });

  function resolveColour(expr, fallback) {
    try {
      probeEl.style.color = '';
      probeEl.style.color = expr;
      var serialised = getComputedStyle(probeEl).color;
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = '#000';
      probeCtx.fillStyle = serialised;
      probeCtx.fillRect(0, 0, 1, 1);
      var d = probeCtx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) return fallback;
      return [d[0], d[1], d[2]];
    } catch (e) {
      return fallback;
    }
  }

  var cs = getComputedStyle(root);
  var DIM = rgbToOklab(resolveColour(cs.getPropertyValue('--sg-dot').trim() || '#858fa6', [133, 143, 166]));
  var LIT = rgbToOklab(resolveColour(cs.getPropertyValue('--sg-accent').trim() || '#5cffc1', [92, 255, 193]));

  // Precomputed ramp: 64 steps of 'rgb(r,g,b)', interpolated in OKLAB. Built
  // once, so a frame is 1,400 array lookups rather than 1,400 colour
  // conversions.
  var STEPS = 64;
  var RAMP = new Array(STEPS);
  for (var i = 0; i < STEPS; i++) {
    // The hue shift is weighted LATE, and the exponent has to be above 1 to do
    // that: at 0.7 the curve pulls up instead of down, a dot at 10% intensity
    // was already a fifth of the way to mint, and the field read as green
    // everywhere. A resting dot has to be neutral grey and only a dot that is
    // genuinely firing has any hue in it at all.
    var t = Math.pow(i / (STEPS - 1), HUE_DELAY);
    var c = oklabToRgb([
      DIM[0] + (LIT[0] - DIM[0]) * t,
      DIM[1] + (LIT[1] - DIM[1]) * t,
      DIM[2] + (LIT[2] - DIM[2]) * t
    ]);
    RAMP[i] = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  /* ---- dots ----------------------------------------------------------- */

  // Deterministic hash, so a dot's phase and weight are stable across resizes
  // and identical on every reload. A Math.random() field reshuffles itself
  // every time the window changes width, which reads as a glitch.
  function hash(x, y, salt) {
    var n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  var dots = [];
  var W = 0, H = 0, dpr = 1;

  function build() {
    var rect = root.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Centre the grid so it stays symmetrical at any width instead of
    // clipping unevenly on the right.
    var cols = Math.floor(W / SPACING) + 2;
    var rows = Math.floor(H / SPACING) + 2;
    var offX = (W - (cols - 1) * SPACING) / 2;
    var offY = (H - (rows - 1) * SPACING) / 2;

    var origins = WAVES.map(function (w) {
      return [w.at[0] * W, w.at[1] * H];
    });

    dots.length = 0;
    for (var gy = 0; gy < rows; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        var x = Math.round(offX + gx * SPACING);
        var y = Math.round(offY + gy * SPACING);

        var d = {
          x: x,
          y: y,
          // Scatter, so the crest is a drift in which dots are firing rather
          // than a clean arc sweeping across a grid. It was 5.6 radians, which
          // is nearly a full cycle: enough to keep every neighbourhood
          // populated, but it also erased the wave, because two neighbouring
          // dots could be at opposite points of their cycle and the front had
          // nothing left to travel through. 2.6 keeps the field from going
          // patchy while leaving the band legible - and the breath term now
          // does the job the big scatter was really there for, which is making
          // sure no region ever looks switched off.
          p: (hash(gx, gy, 1) - 0.5) * 2.6,
          // Only some dots ever get bright, and the distribution is skewed so
          // that most never do. Raising GAMMA alone thins the lit crowd by
          // dimming everything; a skewed weight thins it while the few that do
          // fire still reach full strength.
          w: 0.10 + Math.pow(hash(gx, gy, 2), WEIGHT_SKEW) * 0.90,
          // Resting lift, varied widely per dot. The reference's unlit dots run
          // from almost invisible up to about base-8/15%, and that unevenness
          // is load-bearing: at a uniform 0.09-0.17 the grid read as one flat
          // texture and the lit dots had nothing to stand out against.
          rest: 0.05 + Math.pow(hash(gx, gy, 3), 1.3) * 0.13,
          d: []
        };
        for (var k = 0; k < origins.length; k++) {
          var ddx = x - origins[k][0], ddy = y - origins[k][1];
          d.d.push(Math.sqrt(ddx * ddx + ddy * ddy));
        }
        dots.push(d);
      }
    }
  }

  /* ---- draw ----------------------------------------------------------- */

  var om = WAVES.map(function (w) { return TAU / w.period; });
  var km = WAVES.map(function (w) { return TAU / w.wave; });

  function draw(seconds, calm) {
    ctx.clearRect(0, 0, W, H);

    // Reduced motion keeps the cross-fade but pulls the swing in by half, so
    // the field settles toward its resting texture instead of pulsing.
    var amp = calm ? 0.5 : 1;

    var a0 = seconds * om[0], a1 = seconds * om[1];
    var k0 = km[0], k1 = km[1];

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];

      // Two sines summed. sin is already an ease in and out, so a dot brightens
      // and fades on a curve without any easing function of its own.
      var v = 0.5
        + 0.25 * amp * Math.sin(a0 - d.d[0] * k0 + d.p)
        + 0.25 * amp * Math.sin(a1 - d.d[1] * k1 + d.p * 0.6);

      if (v < 0) v = 0; else if (v > 1) v = 1;

      // Two things ride the same wave, on deliberately different curves.
      //
      // The breath is linear in v, so EVERY dot's resting opacity rises and
      // falls: the field is always moving, gently, everywhere. The firing is
      // pow(v, GAMMA) against a skewed per-dot weight, so only a few dots ever
      // climb far enough up the ramp to take on any mint at all.
      //
      // Driving both from one sharply-gamma'd value, which is what the first
      // version did, is what made the screen look frozen: a dot that was not
      // firing had a completely constant alpha, and at these settings that is
      // most of the field at any instant.
      var base = d.rest * (1 - BREATH * 0.5 + BREATH * v);

      var lit = Math.pow(v, GAMMA) * d.w / PEAK;
      if (lit > 1) lit = 1;

      // The ramp already carries HUE_DELAY, so indexing it with `lit` applies
      // the late hue shift for free; alpha rises on its own slightly faster
      // curve so a dot becomes visible just before it becomes mint.
      ctx.globalAlpha = base + (1 - base) * Math.pow(lit, 1.1);
      ctx.fillStyle = RAMP[(lit * (STEPS - 1)) | 0];
      ctx.fillRect(d.x, d.y, DOT, DOT);
    }

    ctx.globalAlpha = 1;
  }

  /* ---- loop ----------------------------------------------------------- */

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var raf = null;
  var last = 0;
  var interval = 1000 / FPS;
  var t0 = 0;

  function frame(now) {
    raf = window.requestAnimationFrame(frame);
    if (document.hidden) return;
    if (now - last < interval) return;
    last = now;
    if (!t0) t0 = now;
    // Half speed under reduced motion. Amplitude is halved inside draw().
    var calm = reduced && reduced.matches;
    draw(((now - t0) / 1000) * (calm ? 0.5 : 1), calm);
  }

  function start() {
    stop();
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (raf !== null) { window.cancelAnimationFrame(raf); raf = null; }
  }

  /* ---- lifecycle ------------------------------------------------------ */

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 120);
  }

  build();
  start();

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) last = 0;   // draw immediately on return
  });
  if (reduced && reduced.addEventListener) {
    reduced.addEventListener('change', start);
  }

  /* ---- submit feedback -------------------------------------------------
     The SSO round trip is a full-page redirect and can sit for a second or
     two on a cold identity provider. Without this the button looks dead and
     people click it twice. */

  var btn = document.querySelector('.sg-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = '<span class="sg-spin"></span>Redirecting';
    });
  }
})();

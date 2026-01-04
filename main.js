// ---- Revēl v0.11.7 ----
// Changes in this build:
// - ⚡️ Burst earns randomly every 4–5 reveals (persists across scene restarts)
// - Burst clear = center-out shockwave (STEPS=30, STEP_MS=130 ≈ 3.9s)
// - Faster pic changeover: no long sequential awaits (parallelize transition)
// - AUTO_ADVANCE_MS reduced (1.2s) so next round starts faster
// - Title centered in remaining free space between ↻ and right controls
// - Fix: rightPad defined before it’s used (prevents Phaser crash)

(() => {
  const VERSION = "Revēl v0.11.7";

  const host = document.getElementById("game");
  const show = (msg) => {
    document.body.innerHTML =
      `<pre style="white-space:pre-wrap;font:16px/1.4 -apple-system;margin:12px;color:#fff;background:#000;padding:12px;border-radius:12px">${msg}</pre>`;
  };

  if (!host) return show('Missing <div id="game"></div> in HTML.');
  if (typeof window.Phaser === "undefined") {
    return show(
      "Phaser did NOT load.\n\nFix: CodePen → Settings → JavaScript → External Scripts:\n" +
      "https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js\n\n" +
      "Remove any blank script lines, then SAVE."
    );
  }

  // Prevent iOS gesture weirdness (optional but helps)
  try {
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  } catch {}

  const W = window.innerWidth;
  const H = window.innerHeight;

  const BAR_H = 56;
  const PLAY_H = H - BAR_H;

  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = W + "px";
  host.style.height = H + "px";
  host.style.overflow = "hidden";
  host.style.touchAction = "none";

  host.style.backgroundSize = "cover";
  host.style.backgroundPosition = "center";
  host.style.backgroundRepeat = "no-repeat";
  host.style.backgroundColor = "#0b0f14";

  // ---------- BACKGROUNDS ----------
  const PORTRAIT_W = 1200;
  const PORTRAIT_H = 2000;

  function unsplashRandomUrl(keywords, sig) {
    const q = encodeURIComponent(keywords);
    return `https://source.unsplash.com/random/${PORTRAIT_W}x${PORTRAIT_H}/?${q}&sig=${sig}`;
  }
  function picsumFallbackUrl(seed) {
    const s = encodeURIComponent(seed);
    return `https://picsum.photos/seed/${s}/${PORTRAIT_W}/${PORTRAIT_H}`;
  }
  function wikimediaFilePath(filename) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}`;
  }

  const SPECIALS = [
    wikimediaFilePath("Mona%20Lisa%2C%20by%20Leonardo%20da%20Vinci%2C%20from%20C2RMF.jpg"),
    wikimediaFilePath("Van%20Gogh%20-%20Starry%20Night%20-%20Google%20Art%20Project.jpg"),
    wikimediaFilePath("Taj%20Mahal%20Front.JPG"),
  ];

  const KEYWORD_SETS = [
    "mountains,alpine,lake,sunset,landscape",
    "forest,mist,trees,trail,fog",
    "waterfall,river,rocks,moss,nature",
    "desert,dunes,dramatic,sky,landscape",
    "autumn,forest,colors,trail",
    "ocean,waves,beach,sea,aerial",
    "coastline,cliffs,ocean,surf",
    "underwater,reef,coral,blue",
    "jellyfish,underwater,glow",
    "sea,turtle,underwater",
    "city,skyline,night,neon,street",
    "architecture,building,modern,lines",
    "bridge,city,lights,night",
    "castle,architecture,old,stone",
    "temple,architecture,columns",
    "space,galaxy,nebula,stars,planet",
    "milkyway,stars,night,sky",
    "astronaut,space,suit",
    "moon,craters,space",
    "wildlife,animal,portrait,eyes",
    "lion,animal,closeup",
    "owl,bird,portrait,eyes",
    "butterfly,macro,insect",
    "beetle,insect,macro",
  ];

  const UNSPLASH_URLS = [];
  let sig = 1;
  while (UNSPLASH_URLS.length < 54) {
    for (const kw of KEYWORD_SETS) {
      if (UNSPLASH_URLS.length >= 54) break;
      UNSPLASH_URLS.push(unsplashRandomUrl(kw, sig++));
    }
  }
  const ALL_URLS = UNSPLASH_URLS.concat(SPECIALS);

  let bag = [];
  let bagIndex = 0;

  function reshuffleBag() {
    bag = ALL_URLS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    bagIndex = 0;
  }
  reshuffleBag();

  function nextUrl() {
    if (bagIndex >= bag.length) reshuffleBag();
    return { url: bag[bagIndex], idx: bagIndex++ };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error("Image failed"));
      img.src = url;
    });
  }

  async function setNextBackground() {
    const pick = nextUrl();
    const seed = `revel-${pick.idx}-${Date.now()}`;

    try {
      const ok = await loadImage(pick.url);
      host.style.backgroundImage = `url("${ok}")`;
      return;
    } catch {}

    const fallback = picsumFallbackUrl(seed);
    try {
      const ok2 = await loadImage(fallback);
      host.style.backgroundImage = `url("${ok2}")`;
      return;
    } catch {}

    host.style.backgroundImage =
      "linear-gradient(180deg, rgba(20,28,40,1) 0%, rgba(10,12,18,1) 100%)";
  }

  setNextBackground();

  // ---------- GAMEPLAY ----------
  const CELL = 14;
  const COLS = Math.ceil(W / CELL);
  const ROWS = Math.ceil(PLAY_H / CELL);
  const TOTAL = COLS * ROWS;

  // Tools
  const TOOL_SIZES = [2.5, 3.0];
  let toolSizeIndex = 0;

  const SHAPES = ["round", "square", "star", "heart"];
  let shapeIndex = 0;

  function getRadius() { return TOOL_SIZES[toolSizeIndex]; }
  function getShape() { return SHAPES[shapeIndex]; }

  // Movement tuning
  const MIN_SPEED = 0.06;
  const MAX_SPEED = 2.4;
  const SPEED_GAMMA = 3.0;

  const RESIST_SPEED_POWER = 1.05;
  const RESIST_STRENGTH_POWER = 0.78;

  // Fog tuning
  const WIPE_STRENGTH = 0.32;
  const CLEAN_THRESH = 0.12;
  const FINISH_CLEAN_FRACTION = 0.985;

  const FOG_ALPHA_MAX = 0.95;
  const GRAIN = 18;

  // Resistance map
  const RESIST_MIN = 0.85;
  const RESIST_MAX = 1.24;

  const SMUDGE_COUNT_MIN = 2;
  const SMUDGE_COUNT_MAX = 4;
  const SMUDGE_RADIUS_MIN = 2.6;
  const SMUDGE_RADIUS_MAX = 5.0;
  const SMUDGE_BOOST_MIN = 0.28;
  const SMUDGE_BOOST_MAX = 0.62;

  // Completion / transitions
  const AUTO_ADVANCE_MS = 1200; // faster changeover per feedback
  let transitionActive = false;
  let burstActive = false;

  // Persistent Burst state across scene restarts
  let hasBurst = false;
  let revealsUntilBurst = randInt(4, 5);

  // State per run
  let density, isClean, cleanedCells = 0;
  let resist;
  let toolPos = { x: W / 2, y: BAR_H + PLAY_H / 2 };
  let target = { x: W / 2, y: BAR_H + PLAY_H / 2 };
  let finished = false;
  let startTimeMs = 0;

  // Haptics
  let lastHapticMs = 0;
  const HAPTIC_PERIOD_MS = 85;
  const HAPTIC_MIN_MS = 3;
  const HAPTIC_MAX_MS = 18;

  // Fog color mode (persist across restarts)
  let rainbowFog = false;

  // RNG + noise
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeValueNoise(cols, rows, rng) {
    const step = 8;
    const gx = Math.ceil(cols / step) + 2;
    const gy = Math.ceil(rows / step) + 2;

    const grid = new Float32Array(gx * gy);
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) grid[j * gx + i] = rng();
    }

    const out = new Float32Array(cols * rows);

    for (let y = 0; y < rows; y++) {
      const fy = y / step;
      const y0 = Math.floor(fy);
      const ty = fy - y0;

      for (let x = 0; x < cols; x++) {
        const fx = x / step;
        const x0 = Math.floor(fx);
        const tx = fx - x0;

        const a = grid[y0 * gx + x0];
        const b = grid[y0 * gx + (x0 + 1)];
        const c = grid[(y0 + 1) * gx + x0];
        const d = grid[(y0 + 1) * gx + (x0 + 1)];

        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);

        const ab = a + (b - a) * sx;
        const cd = c + (d - c) * sx;
        out[y * cols + x] = ab + (cd - ab) * sy;
      }
    }
    return out;
  }

  function buildResistanceMap(seed) {
    const rng = mulberry32(seed);

    const n0 = makeValueNoise(COLS, ROWS, rng);
    const n1 = makeValueNoise(COLS, ROWS, rng);

    resist = new Float32Array(TOTAL);

    for (let i = 0; i < TOTAL; i++) {
      let v = 0.72 * n0[i] + 0.28 * n1[i];
      v = RESIST_MIN + (RESIST_MAX - RESIST_MIN) * v;
      resist[i] = v;
    }

    const smudgeCount =
      Math.floor(SMUDGE_COUNT_MIN + rng() * (SMUDGE_COUNT_MAX - SMUDGE_COUNT_MIN + 1));

    for (let s = 0; s < smudgeCount; s++) {
      const cx = Math.floor(rng() * COLS);
      const cy = Math.floor(rng() * ROWS);

      const rad = SMUDGE_RADIUS_MIN + rng() * (SMUDGE_RADIUS_MAX - SMUDGE_RADIUS_MIN);
      const radCeil = Math.ceil(rad);
      const rad2 = rad * rad;

      const boost = SMUDGE_BOOST_MIN + rng() * (SMUDGE_BOOST_MAX - SMUDGE_BOOST_MIN);

      for (let dy = -radCeil; dy <= radCeil; dy++) {
        for (let dx = -radCeil; dx <= radCeil; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;

          const d2 = dx * dx + dy * dy;
          if (d2 > rad2) continue;

          const t = 1 - d2 / (rad2 + 1e-6);
          const soft = t * t;

          const idx = y * COLS + x;
          resist[idx] = clamp(resist[idx] + boost * soft, RESIST_MIN, 2.1);
        }
      }
    }
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = (h % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;

    if (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
    else if (hp < 2)       { r = x; g = c; b = 0; }
    else if (hp < 3)       { r = 0; g = c; b = x; }
    else if (hp < 4)       { r = 0; g = x; b = c; }
    else if (hp < 5)       { r = x; g = 0; b = c; }
    else                   { r = c; g = 0; b = x; }

    const m = v - c;
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: W,
    height: H,
    transparent: true,
    scene: { create, update }
  });

  setTimeout(() => {
    const c = host.querySelector("canvas");
    if (c) {
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      c.style.zIndex = "2";
    }
  }, 50);

  function create() {
    density = new Float32Array(TOTAL);
    isClean = new Uint8Array(TOTAL);
    density.fill(1);
    isClean.fill(0);
    cleanedCells = 0;
    finished = false;
    transitionActive = false;
    burstActive = false;
    startTimeMs = performance.now();

    const seed = (Date.now() ^ ((Math.random() * 1e9) | 0)) >>> 0;
    buildResistanceMap(seed);

    this.textures.createCanvas("fog", COLS, ROWS);
    this.add.image(0, BAR_H, "fog").setOrigin(0, 0).setScale(CELL);
    this.game.renderer.config.antialias = false;

    // Top bar
    this.add.rectangle(W / 2, BAR_H / 2, W, BAR_H, 0x0b0f14, 1.0);
    this.add.rectangle(W / 2, BAR_H - 1, W, 2, 0xffffff, 0.08);

    // Frame
    const FRAME_PAD = 6;
    const frame = this.add.rectangle(
      W / 2,
      BAR_H + PLAY_H / 2,
      W - FRAME_PAD * 2,
      PLAY_H - FRAME_PAD * 2,
      0x000000,
      0
    );
    frame.setStrokeStyle(2, 0xffffff, 0.10);

    // Left: ↻
    const reset = this.add.text(16, BAR_H / 2, "↻", {
      fontSize: "26px",
      color: "#ffffff"
    }).setOrigin(0, 0.5).setInteractive();

    // Right controls (define first so title math can reference rightPad)
    const rightY = BAR_H / 2;
    const rightPad = 14;

    // Center title in remaining free space
    const leftSafeX = 16 + 34;                     // ↻ icon + padding
    const rightControlsLeftX = W - rightPad - 260;  // left edge of right-side cluster
    const titleX = (leftSafeX + rightControlsLeftX) / 2;

    this.add.text(titleX, BAR_H / 2, "Revēl", {
      fontSize: "20px",
      color: "#ffffff"
    }).setOrigin(0.5, 0.5);

    // Right: 🌈
    this.add.text(W - rightPad, rightY, "🌈", {
      fontSize: "22px",
      color: "#ffffff"
    }).setOrigin(1, 0.5);

    const rainbowHit = this.add.rectangle(W - rightPad - 10, rightY, 54, 46, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setInteractive();

    // Shape icon + hit
    const shapeIcon = () => {
      const s = getShape();
      if (s === "round") return "●";
      if (s === "square") return "■";
      if (s === "star") return "★";
      return "♥";
    };

    const shapeText = this.add.text(W - rightPad - 68, rightY, shapeIcon(), {
      fontSize: "26px",
      color: "#ffffff"
    }).setOrigin(0.5, 0.5);

    const shapeHit = this.add.rectangle(W - rightPad - 68, rightY, 66, 46, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setInteractive();

    // Size dots (Normal smaller, Easy larger)
    const dotGap = 34;
    const dotsCenterX = W - rightPad - 150;

    const dotNormal = this.add.circle(dotsCenterX - dotGap / 2, rightY, 8, 0xffffff, 0.25);
    const dotEasy   = this.add.circle(dotsCenterX + dotGap / 2, rightY, 11, 0xffffff, 0.25);
    const dots = [dotNormal, dotEasy];

    const dotsHit = [
      this.add.rectangle(dotsCenterX - dotGap / 2, rightY, 52, 46, 0x000000, 0).setInteractive(),
      this.add.rectangle(dotsCenterX + dotGap / 2, rightY, 52, 46, 0x000000, 0).setInteractive(),
    ];

    const updateDots = () => {
      for (let i = 0; i < dots.length; i++) {
        const on = i === toolSizeIndex;
        dots[i].setFillStyle(0xffffff, on ? 0.95 : 0.25);
        dots[i].setScale(on ? 1.10 : 1.0);
      }
    };
    updateDots();

    // ⚡️ Burst icon (only visible when available)
    const burstX = W - rightPad - 210;
    const burstText = this.add.text(burstX, rightY, "⚡️", {
      fontSize: "24px",
      color: "#ffffff"
    }).setOrigin(0.5, 0.5);

    const burstHit = this.add.rectangle(burstX, rightY, 58, 46, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setInteractive();

    const burstPulse = this.tweens.add({
      targets: burstText,
      alpha: { from: 1, to: 0.55 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      paused: true
    });

    const setBurstVisible = (v) => {
      burstText.setVisible(v);
      burstHit.setVisible(v);
      if (v) burstPulse.resume();
      else burstPulse.pause();
    };
    setBurstVisible(hasBurst);

    // Tool visual
    const toolG = this.add.graphics();
    toolG.setDepth(10);

    const drawTool = () => {
      toolG.clear();
      const r = getRadius();
      const px = toolPos.x;
      const py = toolPos.y;

      toolG.fillStyle(0xffffff, 0.08);
      toolG.lineStyle(2, 0xffffff, 0.20);

      const shape = getShape();
      const radPx = CELL * (r + 1);

      if (shape === "square") {
        const size = CELL * (r * 2 + 1.2);
        const half = size / 2;
        toolG.fillRect(px - half, py - half, size, size);
        toolG.strokeRect(px - half, py - half, size, size);
        return;
      }

      if (shape === "round") {
        toolG.fillCircle(px, py, radPx);
        toolG.strokeCircle(px, py, radPx);
        return;
      }

      if (shape === "star") {
        drawStarPoly(toolG, px, py, radPx, radPx * 0.45, 5);
        return;
      }

      drawHeartPoly(toolG, px, py, radPx);
    };

    // Version label
    this.add.text(14, H - 12, VERSION, {
      fontSize: "14px",
      color: "#ffffff",
      backgroundColor: "#00000055",
      padding: { x: 8, y: 4 }
    }).setOrigin(0, 1);

    // Completion message (single line)
    const doneText = this.add.text(W / 2, BAR_H + 16, "", {
      fontSize: "22px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 14, y: 10 }
    }).setOrigin(0.5, 0).setVisible(false);

    // Sparkles
    const sparkleG = this.add.graphics().setDepth(11);

    // --- interactions ---
    // ✅ CHANGE #2 (ONLY): make reset async + await setNextBackground() before restart
    reset.on("pointerdown", async () => {
      if (transitionActive || burstActive) return;
      transitionActive = true;

      // cloak immediately (no peeking)
      cloakNow(this);

      // flash for delight (no await)
      tripleFlash(this);

      // IMPORTANT: wait until the next background is actually applied
      await setNextBackground();

      // restart only after background is set
      this.scene.restart();
    });

    burstHit.on("pointerdown", async () => {
      if (!hasBurst) return;
      if (transitionActive || burstActive) return;

      hasBurst = false;
      setBurstVisible(false);

      await triggerBurstClear(this);
    });

    const setToolSize = (idx) => {
      toolSizeIndex = idx;
      updateDots();
      drawTool();
    };

    const cycleShape = () => {
      try {
        shapeIndex = (shapeIndex + 1) % SHAPES.length;
        shapeText.setText(shapeIcon());
        drawTool();
      } catch {
        shapeIndex = 0;
        shapeText.setText("●");
        try { drawTool(); } catch {}
      }
    };

    const toggleRainbow = () => {
      rainbowFog = !rainbowFog;
      renderFog(this);
      try { if (navigator.vibrate) navigator.vibrate(8); } catch {}
    };

    dotsHit.forEach((hit, i) => hit.on("pointerdown", () => setToolSize(i)));
    shapeHit.on("pointerdown", cycleShape);
    rainbowHit.on("pointerdown", toggleRainbow);

    // Input: ignore top bar touches
    this.input.on("pointerdown", (p) => {
      if (p.y < BAR_H) return;
      target.x = p.x; target.y = p.y;
      if (finished) sparklePing(this, sparkleG, p.x, p.y);
    });

    this.input.on("pointermove", (p) => {
      if (!p.isDown) return;
      if (p.y < BAR_H) return;
      target.x = p.x; target.y = p.y;
      if (finished) {
        if ((Math.random() * 6) < 1) sparklePing(this, sparkleG, p.x, p.y);
      }
    });

    // Initial render
    renderFog(this);
    drawTool();

    // stash
    this._doneText = doneText;
    this._drawTool = drawTool;
    this._sparkleG = sparkleG;
    this._setBurstVisible = setBurstVisible;
    this._setBurstVisible(hasBurst);
  }

  function update(_, dtMs) {
    const dt = Math.min(dtMs / 16.67, 2);

    const minY = BAR_H + 2;
    const maxY = H - 2;

    const gx = Math.floor(toolPos.x / CELL);
    const gy = Math.floor((toolPos.y - BAR_H) / CELL);

    const fog = sampleDensity(gx, gy);
    const clear = 1 - fog;
    const localRes = sampleResistance(gx, gy);

    const speed01 = Math.pow(clear, SPEED_GAMMA);
    let speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * speed01;
    speed *= 1 / Math.pow(localRes, RESIST_SPEED_POWER);

    const follow = 0.15 * speed;

    toolPos.x += (target.x - toolPos.x) * follow * dt;
    toolPos.y += (target.y - toolPos.y) * follow * dt;
    toolPos.y = clamp(toolPos.y, minY, maxY);

    if (this._drawTool) this._drawTool();

    if (finished || transitionActive || burstActive) return;

    const p = this.input.activePointer;
    if (p.isDown && p.y >= BAR_H) {
      wipeAt(toolPos.x, toolPos.y);
      continuousHaptics(localRes, fog);
      renderFog(this);

      if (cleanedCells / TOTAL >= FINISH_CLEAN_FRACTION) {
        finishNow.call(this, { viaBurst: false });
      }
    }
  }

  function finishNow({ viaBurst }) {
    finished = true;

    // clear fog
    for (let i = 0; i < density.length; i++) density[i] = 0;
    renderFog(this);

    const elapsed = performance.now() - startTimeMs;
    const mm = Math.floor(elapsed / 60000);
    const ss = Math.floor((elapsed % 60000) / 1000);
    const ms = Math.floor((elapsed % 1000) / 10);
    const stamp =
      `${String(mm).padStart(2, "0")}:` +
      `${String(ss).padStart(2, "0")}.` +
      `${String(ms).padStart(2, "0")}`;

    if (this._doneText) {
      const tag = viaBurst ? " (BURST)" : "";
      this._doneText.setText(`REVEALED! IN ${stamp}!${tag}`).setVisible(true);
    }

    // fireworks should not block the next round
    fireworksPopLight(this);

    // Earn logic: decrement and award Burst (4–5) if not already owned
    if (!hasBurst) {
      revealsUntilBurst -= 1;
      if (revealsUntilBurst <= 0) {
        hasBurst = true;
        revealsUntilBurst = randInt(4, 5);
        if (this._setBurstVisible) this._setBurstVisible(true);
        try { if (navigator.vibrate) navigator.vibrate([10, 30, 10]); } catch {}
      }
    }

    // Schedule auto-advance (FAST path: no sequential awaits)
    transitionActive = true;

    // ✅ CHANGE #1 (ONLY): make delayedCall async + await setNextBackground() before restart
    this.time.delayedCall(AUTO_ADVANCE_MS, async () => {
      // cloak immediately (no peeking)
      cloakNow(this);

      // flash for delight (no await)
      tripleFlash(this);

      // IMPORTANT: wait until the next background is actually applied
      await setNextBackground();

      // restart only after background is set
      this.scene.restart();
    });
  }

  // ⚡️ Burst clear: center-out shockwave (≈3.9s), then finishes normally
  async function triggerBurstClear(scene) {
    burstActive = true;

    // small charge-up flash
    const charge = scene.add.rectangle(W / 2, BAR_H + PLAY_H / 2, W, PLAY_H, 0xffffff, 0.03);
    scene.tweens.add({
      targets: charge,
      alpha: 0,
      duration: 220,
      onComplete: () => charge.destroy()
    });

    // "whoosh" lines (very light)
    for (let i = 0; i < 6; i++) {
      const y = BAR_H + 40 + Math.random() * (PLAY_H - 80);
      const line = scene.add.rectangle(W / 2, y, W, 2, 0xffffff, 0.05);
      scene.tweens.add({
        targets: line,
        alpha: 0,
        duration: 500 + Math.random() * 250,
        onComplete: () => line.destroy()
      });
    }

    // Clear with a center-out shockwave (power-up feel)
    const STEPS = 30;
    const STEP_MS = 130; // 30 * 130 ≈ 3.9s

    const cx = (COLS - 1) / 2;
    const cy = (ROWS - 1) / 2;
    const maxR = Math.hypot(Math.max(cx, COLS - 1 - cx), Math.max(cy, ROWS - 1 - cy));
    const feather = 1.2;

    for (let s = 0; s < STEPS; s++) {
      const t = (s + 1) / STEPS;
      const r = t * maxR;

      // optional: a subtle pulse ring for clarity
      const ring = scene.add.circle(W / 2, BAR_H + PLAY_H / 2, 20, 0xffffff, 0.0).setStrokeStyle(4, 0xffffff, 0.16);
      scene.tweens.add({
        targets: ring,
        radius: 60 + t * (Math.min(W, PLAY_H) * 0.55),
        alpha: 0,
        duration: 240,
        onComplete: () => ring.destroy()
      });

      for (let y = 0; y < ROWS; y++) {
        const dy = y - cy;
        const rowBase = y * COLS;
        for (let x = 0; x < COLS; x++) {
          const dx = x - cx;
          const d = Math.hypot(dx, dy);

          if (d <= r - feather) {
            density[rowBase + x] = 0;
          } else if (d <= r + feather) {
            density[rowBase + x] = Math.max(0, density[rowBase + x] - 0.25);
          }
        }
      }

      renderFog(scene);
      await waitMs(scene, STEP_MS);
    }

    // Ensure fully clear
    for (let i = 0; i < density.length; i++) density[i] = 0;
    renderFog(scene);

    burstActive = false;

    finishNow.call(scene, { viaBurst: true });
  }

  // Cloak instantly with full fog
  function cloakNow(scene) {
    if (scene._doneText) scene._doneText.setVisible(false);

    for (let i = 0; i < density.length; i++) {
      density[i] = 1;
      isClean[i] = 0;
    }
    cleanedCells = 0;
    renderFog(scene);
  }

  async function tripleFlash(scene) {
    // fast flashes so we don’t add dead time
    const flashOnce = () => new Promise((resolve) => {
      const f = scene.add.rectangle(W / 2, BAR_H + PLAY_H / 2, W, PLAY_H, 0xffffff, 0.06);
      scene.tweens.add({
        targets: f,
        alpha: 0,
        duration: 95,
        onComplete: () => { f.destroy(); resolve(); }
      });
    });

    await flashOnce();
    await waitMs(scene, 85);
    await flashOnce();
    await waitMs(scene, 85);
    await flashOnce();
  }

  function waitMs(scene, ms) {
    return new Promise((resolve) => scene.time.delayedCall(ms, resolve));
  }

  // Brush geometry
  function insideBrush(dx, dy, radius) {
    const shape = getShape();

    if (shape === "round") {
      const d2 = dx * dx + dy * dy;
      return d2 <= radius * radius;
    }

    if (shape === "square") {
      return Math.max(Math.abs(dx), Math.abs(dy)) <= radius;
    }

    const nx = dx / (radius + 1e-6);
    const ny = dy / (radius + 1e-6);

    if (shape === "star") {
      const r = Math.hypot(nx, ny);
      if (r > 1) return false;
      const ang = Math.atan2(ny, nx);
      const spikes = 5;
      const m = 0.55 + 0.45 * Math.cos(spikes * ang);
      return r <= m;
    }

    // Heart implicit
    const x = nx * 1.2;
    const y = ny * 1.2;
    const a = x * x + y * y - 1;
    const f = a * a * a - x * x * y * y * y;
    return f <= 0.0;
  }

  function brushFalloff(dx, dy, radius) {
    const shape = getShape();

    if (shape === "round") {
      const d2 = dx * dx + dy * dy;
      const r2 = radius * radius;
      const t = 1 - d2 / (r2 + 1e-6);
      return clamp(t, 0, 1);
    }

    const d = Math.max(Math.abs(dx), Math.abs(dy));
    let t = 1 - d / (radius + 1e-6);
    t = clamp(t, 0, 1);
    return t * t;
  }

  function wipeAt(x, y) {
    const radius = getRadius();
    const R_CEIL = Math.ceil(radius);

    const gx = Math.floor(x / CELL);
    const gy = Math.floor((y - BAR_H) / CELL);

    for (let dy = -R_CEIL; dy <= R_CEIL; dy++) {
      for (let dx = -R_CEIL; dx <= R_CEIL; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;

        if (!insideBrush(dx, dy, radius)) continue;

        const idx = ny * COLS + nx;
        const before = density[idx];
        if (before <= 0) continue;

        const t = brushFalloff(dx, dy, radius);

        const r = resist[idx];
        const resistFactor = 1 / Math.pow(r, RESIST_STRENGTH_POWER);

        const strength = WIPE_STRENGTH * t * resistFactor;
        density[idx] = Math.max(0, before - strength);

        if (isClean[idx] === 0 && density[idx] <= CLEAN_THRESH) {
          isClean[idx] = 1;
          cleanedCells++;
        }
      }
    }
  }

  function renderFog(scene) {
    const canvas = scene.textures.get("fog").getSourceImage();
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, COLS, ROWS);
    const data = img.data;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        const f = density[i];

        const h = ((i * 1103515245 + 12345) >>> 16) & 255;
        const grain = (h - 128) / 128;

        let a = f * FOG_ALPHA_MAX;
        a += grain * (GRAIN / 255) * f;
        a = clamp(a, 0, 1);

        let rgb;
        if (!rainbowFog) {
          rgb = { r: 235, g: 235, b: 240 };
        } else {
          const hue = (x * 7 + y * 5) % 360;
          rgb = hsvToRgb(hue, 0.35, 0.97);
        }

        const p = i * 4;
        data[p]     = rgb.r;
        data[p + 1] = rgb.g;
        data[p + 2] = rgb.b;
        data[p + 3] = (a * 255) | 0;
      }
    }

    ctx.putImageData(img, 0, 0);
    scene.textures.get("fog").refresh();
  }

  function fireworksPopLight(scene) {
    const flash = scene.add.rectangle(W / 2, BAR_H + PLAY_H / 2, W, PLAY_H, 0xffffff, 0.08);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 160, onComplete: () => flash.destroy() });

    for (let b = 0; b < 5; b++) {
      const x = 60 + Math.random() * (W - 120);
      const y = BAR_H + 90 + Math.random() * (PLAY_H - 180);

      const ring = scene.add.circle(x, y, 8, 0xffffff, 0.0).setStrokeStyle(3, 0xffffff, 0.9);
      scene.tweens.add({
        targets: ring,
        radius: 70 + Math.random() * 40,
        alpha: 0,
        duration: 480 + Math.random() * 200,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy()
      });

      const dot = scene.add.circle(x, y, 6, 0xffffff, 0.7);
      scene.tweens.add({
        targets: dot,
        alpha: 0,
        scale: 2.5,
        duration: 280,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy()
      });
    }
  }

  function sparklePing(scene, g, x, y) {
    if (!g) return;
    const r = 2 + Math.random() * 3;
    const a = 0.25 + Math.random() * 0.25;

    const c = scene.add.circle(x, y, r, 0xffffff, a).setDepth(12);
    scene.tweens.add({
      targets: c,
      alpha: 0,
      scale: 2.2,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => c.destroy()
    });
  }

  function continuousHaptics(localRes, localFog) {
    const now = performance.now();
    if (now - lastHapticMs < HAPTIC_PERIOD_MS) return;
    lastHapticMs = now;

    const intensity = clamp((localRes - 0.85) / 1.1, 0, 1) * clamp(localFog, 0, 1);
    const dur = Math.round(HAPTIC_MIN_MS + (HAPTIC_MAX_MS - HAPTIC_MIN_MS) * intensity);

    try { if (navigator.vibrate) navigator.vibrate(dur); } catch {}
  }

  function sampleDensity(gx, gy) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        sum += density[y * COLS + x];
        n++;
      }
    }
    return n ? sum / n : 1;
  }

  function sampleResistance(gx, gy) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        sum += resist[y * COLS + x];
        n++;
      }
    }
    return n ? sum / n : 1.0;
  }

  function drawStarPoly(g, cx, cy, outerR, innerR, points) {
    const pts = [];
    const step = Math.PI / points;
    let angle = -Math.PI / 2;
    for (let i = 0; i < points * 2; i++) {
      const r = (i % 2 === 0) ? outerR : innerR;
      pts.push(new Phaser.Math.Vector2(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
      angle += step;
    }
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
  }

  function drawHeartPoly(g, cx, cy, r) {
    const steps = 44;
    const pts = [];
    const scale = r / 18;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const s = Math.sin(t);
      const x = 16 * s * s * s;
      const y =
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        1 * Math.cos(4 * t);
      pts.push(new Phaser.Math.Vector2(cx + x * scale, cy - y * scale));
    }
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
  }

  function randInt(a, b) {
    return (a + Math.floor(Math.random() * (b - a + 1)));
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
})();

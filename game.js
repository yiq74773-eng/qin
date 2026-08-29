(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const HORIZON = 205;
  const ROAD_BOTTOM = 770;

  const ui = {
    bankCoins: document.getElementById("bankCoins"),
    bankTickets: document.getElementById("bankTickets"),
    exchangeButton: document.getElementById("exchangeButton"),
    drawButton: document.getElementById("drawButton"),
    lotteryHint: document.getElementById("lotteryHint"),
    distance: document.getElementById("distanceValue"),
    runCoins: document.getElementById("runCoinsValue"),
    zone: document.getElementById("zoneValue"),
    bossValue: document.getElementById("bossDistanceValue"),
    bossBar: document.getElementById("bossDistanceBar"),
    effectBar: document.getElementById("effectBar"),
    toast: document.getElementById("toast"),
    startOverlay: document.getElementById("startOverlay"),
    resultOverlay: document.getElementById("resultOverlay"),
    startButton: document.getElementById("startButton"),
    restartButton: document.getElementById("restartButton"),
    resultDistance: document.getElementById("resultDistance"),
    resultCoins: document.getElementById("resultCoins"),
    resultTickets: document.getElementById("resultTickets")
  };

  const zones = [
    { name: "校门林荫道", sky: ["#8dd9ff", "#e6f8ff"], road: "#8aa0ad", side: "#76bd78", accent: "#2357a6" },
    { name: "教学楼走廊", sky: ["#d8edff", "#f9fdff"], road: "#b9c4ca", side: "#d7e1e5", accent: "#356eb5" },
    { name: "学生食堂", sky: ["#ffc883", "#fff1d1"], road: "#b7a391", side: "#d8c3a7", accent: "#e45035" },
    { name: "篮球场", sky: ["#70c6ff", "#dff6ff"], road: "#b66d46", side: "#5bad63", accent: "#ff7b25" },
    { name: "宿舍小路", sky: ["#9099cf", "#dde2ff"], road: "#7d859c", side: "#668467", accent: "#7652a8" }
  ];

  const saveKey = "chenkunkuaipao-save-v1";
  let wallet = loadWallet();
  let sprites = {};
  let lastTime = performance.now();
  let toastTimer = 0;
  let swipeStart = null;

  const game = {
    phase: "menu",
    introTime: 0,
    angelTime: 0,
    distance: 0,
    runCoins: 0,
    ticketsUsed: 0,
    bossDistance: 60,
    lane: 0,
    laneVisual: 0,
    jumpTime: 0,
    slideTime: 0,
    invulnerableUntil: 0,
    boostUntil: 0,
    magnetUntil: 0,
    shield: 0,
    revive: 0,
    objects: [],
    spawnTimer: .65,
    projectileTimer: 10,
    elapsed: 0,
    speed: .21,
    shake: 0,
    flash: 0,
    frozenObjects: [],
    lastZone: -1
  };

  function loadWallet() {
    try {
      const raw = JSON.parse(localStorage.getItem(saveKey) || "{}");
      return {
        coins: Number.isFinite(raw.coins) ? Math.max(0, Math.floor(raw.coins)) : 0,
        tickets: Number.isFinite(raw.tickets) ? Math.max(0, Math.floor(raw.tickets)) : 1
      };
    } catch {
      return { coins: 0, tickets: 1 };
    }
  }

  function saveWallet() {
    localStorage.setItem(saveKey, JSON.stringify(wallet));
    updateUi();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function removeConnectedLightBackground(image) {
    const offscreen = document.createElement("canvas");
    offscreen.width = image.naturalWidth || image.width;
    offscreen.height = image.naturalHeight || image.height;
    const off = offscreen.getContext("2d", { willReadFrequently: true });
    off.drawImage(image, 0, 0);

    try {
      const frame = off.getImageData(0, 0, offscreen.width, offscreen.height);
      const data = frame.data;
      const width = offscreen.width;
      const height = offscreen.height;
      const total = width * height;
      const visited = new Uint8Array(total);
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;

      const isBackdrop = (index) => {
        const p = index * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const high = Math.max(r, g, b);
        const low = Math.min(r, g, b);
        return low > 174 && high - low < 20;
      };

      const enqueue = (index) => {
        if (index < 0 || index >= total || visited[index] || !isBackdrop(index)) return;
        visited[index] = 1;
        queue[tail++] = index;
      };

      for (let x = 0; x < width; x += 2) {
        enqueue(x);
        enqueue((height - 1) * width + x);
      }
      for (let y = 0; y < height; y += 2) {
        enqueue(y * width);
        enqueue(y * width + width - 1);
      }

      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        if (x > 0) enqueue(index - 1);
        if (x < width - 1) enqueue(index + 1);
        if (index >= width) enqueue(index - width);
        if (index < total - width) enqueue(index + width);
      }

      for (let index = 0; index < total; index++) {
        if (visited[index]) data[index * 4 + 3] = 0;
      }
      off.putImageData(frame, 0, 0);
    } catch (error) {
      console.warn("背景自动抠除不可用，将显示原始角色图。", error);
    }

    return offscreen;
  }

  async function loadSprites() {
    const [hero, villain, angel] = await Promise.all([
      loadImage("assets/hero.webp"),
      loadImage("assets/villain.webp"),
      loadImage("assets/angel.webp")
    ]);
    sprites = {
      hero: removeConnectedLightBackground(hero),
      villain: removeConnectedLightBackground(villain),
      angel: removeConnectedLightBackground(angel)
    };
  }

  function resetRun() {
    Object.assign(game, {
      phase: "intro",
      introTime: 0,
      angelTime: 0,
      distance: 0,
      runCoins: 0,
      ticketsUsed: 0,
      bossDistance: 60,
      lane: 0,
      laneVisual: 0,
      jumpTime: 0,
      slideTime: 0,
      invulnerableUntil: 0,
      boostUntil: 0,
      magnetUntil: 0,
      shield: 0,
      revive: 0,
      objects: [],
      spawnTimer: .65,
      projectileTimer: 10,
      elapsed: 0,
      speed: .21,
      shake: 0,
      flash: 0,
      frozenObjects: [],
      lastZone: -1
    });
    ui.resultOverlay.classList.add("hidden");
    updateUi();
    canvas.focus();
  }

  function startRunning() {
    game.phase = "running";
    game.introTime = 0;
    showToast("开跑！别让橙衣反派追上来", 1800);
  }

  function moveLeft() {
    if (game.phase === "running") game.lane = Math.max(-1, game.lane - 1);
  }

  function moveRight() {
    if (game.phase === "running") game.lane = Math.min(1, game.lane + 1);
  }

  function jump() {
    if (game.phase === "running" && game.jumpTime <= 0 && game.slideTime <= 0) game.jumpTime = .82;
  }

  function slide() {
    if (game.phase === "running" && game.slideTime <= 0 && game.jumpTime <= 0) game.slideTime = .7;
  }

  function handleAction(action) {
    if (action === "left") moveLeft();
    if (action === "right") moveRight();
    if (action === "jump") jump();
    if (action === "slide") slide();
  }

  function showToast(message, duration = 1500) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), duration);
  }

  function exchangeTicket() {
    if (wallet.coins < 200) {
      showToast("还差一点金币，继续跑！");
      return;
    }
    wallet.coins -= 200;
    wallet.tickets += 1;
    saveWallet();
    showToast("兑换成功：彩票 +1");
  }

  function drawLottery() {
    if (game.phase !== "running") {
      showToast("开始跑酷后才能开奖");
      return;
    }
    if (wallet.tickets < 1) {
      showToast("没有彩票，先用金币兑换");
      return;
    }

    wallet.tickets -= 1;
    game.ticketsUsed += 1;
    const roll = Math.random();
    let message = "";

    if (roll < .30) {
      game.boostUntil = game.elapsed + 6;
      game.invulnerableUntil = game.elapsed + 6;
      game.bossDistance = clamp(game.bossDistance + 15, 0, 100);
      message = "疾风加速！6 秒无敌，反派距离 +15";
    } else if (roll < .52) {
      game.shield = 1;
      message = "护身书包！可抵挡一次碰撞";
    } else if (roll < .70) {
      game.magnetUntil = game.elapsed + 10;
      message = "金币磁铁！持续 10 秒";
    } else if (roll < .85) {
      if (game.revive) {
        wallet.coins += 100;
        message = "已有复活机会，自动兑换为 100 金币";
      } else {
        game.revive = 1;
        message = "获得一次原地复活";
      }
    } else if (roll < .92) {
      wallet.coins += 200;
      message = "幸运返还！金币 +200";
    } else {
      game.bossDistance = Math.max(5, game.bossDistance - 20);
      game.shake = .35;
      message = "坏运气：反派突然逼近 20 米！";
    }

    saveWallet();
    showToast(message, 2600);
    updateUi();
  }

  function updateUi() {
    ui.bankCoins.textContent = wallet.coins;
    ui.bankTickets.textContent = wallet.tickets;
    ui.exchangeButton.disabled = wallet.coins < 200;
    ui.drawButton.disabled = wallet.tickets < 1 || game.phase !== "running";
    ui.lotteryHint.textContent = game.phase === "running"
      ? "开奖池：加速 30% · 护盾 22% · 磁铁 18% · 复活 15% · 返还 7% · Boss逼近 8%"
      : "开奖仅在跑酷过程中可用";
    ui.distance.textContent = `${Math.floor(game.distance)}m`;
    ui.runCoins.textContent = game.runCoins;
    const zoneIndex = Math.floor(game.distance / 430) % zones.length;
    ui.zone.textContent = ["menu", "intro"].includes(game.phase) ? "破旧杂物房" : zones[zoneIndex].name;
    ui.bossValue.textContent = Math.round(game.bossDistance);
    ui.bossBar.style.width = `${game.bossDistance}%`;
    ui.bossBar.style.filter = game.bossDistance < 25 ? "saturate(1.6) brightness(1.2)" : "none";

    const effects = [];
    if (game.boostUntil > game.elapsed) effects.push(`⚡ ${Math.ceil(game.boostUntil - game.elapsed)}s`);
    if (game.magnetUntil > game.elapsed) effects.push(`🧲 ${Math.ceil(game.magnetUntil - game.elapsed)}s`);
    if (game.shield) effects.push("🎒 护盾");
    if (game.revive) effects.push("✨ 复活");
    ui.effectBar.innerHTML = effects.map(effect => `<span>${effect}</span>`).join("");
  }

  function randomLane() {
    return [-1, 0, 1][Math.floor(Math.random() * 3)];
  }

  function spawnCoinTrail() {
    const lane = randomLane();
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      game.objects.push({ type: "coin", lane, z: 1.04 + i * .105, hit: false, bob: Math.random() * Math.PI * 2 });
    }
  }

  function spawnObstacle() {
    const lane = randomLane();
    const pool = [
      { type: "desk", avoid: "jump" },
      { type: "puddle", avoid: "jump" },
      { type: "banner", avoid: "slide" },
      { type: "cone", avoid: "switch" },
      { type: "basketball", avoid: "switch" }
    ];
    const choice = pool[Math.floor(Math.random() * pool.length)];
    game.objects.push({ ...choice, lane, z: 1.04, hit: false, bob: 0 });

    if (game.elapsed > 35 && Math.random() < .23) {
      let secondLane = randomLane();
      while (secondLane === lane) secondLane = randomLane();
      game.objects.push({ type: "cone", avoid: "switch", lane: secondLane, z: 1.04, hit: false, bob: 0 });
    }
  }

  function spawnTicket() {
    game.objects.push({ type: "ticket", lane: randomLane(), z: 1.04, hit: false, bob: Math.random() * Math.PI * 2 });
  }

  function spawnBossProjectile() {
    game.objects.push({ type: "wrench", avoid: "switch", lane: game.lane, z: 1.02, hit: false, bob: 0, bossThrown: true });
    showToast("反派扔出了大扳手！", 1100);
  }

  function collectCoin(object) {
    object.hit = true;
    game.runCoins += 10;
    wallet.coins += 10;
    if (game.runCoins % 50 === 0) game.bossDistance = clamp(game.bossDistance + 2, 0, 100);
    saveWallet();
  }

  function hitObstacle(object) {
    object.hit = true;
    if (game.elapsed < game.invulnerableUntil) {
      game.bossDistance = clamp(game.bossDistance + 2, 0, 100);
      return;
    }
    if (game.shield) {
      game.shield = 0;
      game.invulnerableUntil = game.elapsed + 1.1;
      game.shake = .18;
      showToast("护身书包挡住了碰撞！");
      return;
    }
    const penalty = object.type === "wrench" ? 24 : object.avoid === "switch" ? 18 : 15;
    game.bossDistance -= penalty;
    game.invulnerableUntil = game.elapsed + 1;
    game.shake = .38;
    game.flash = .2;
    showToast(`撞到了${objectLabel(object.type)}，反派逼近 ${penalty} 米`);
  }

  function objectLabel(type) {
    return {
      desk: "课桌",
      puddle: "积水",
      banner: "横幅",
      cone: "路障",
      basketball: "篮球",
      wrench: "大扳手"
    }[type] || "障碍";
  }

  function avoidSatisfied(object) {
    if (object.avoid === "jump") return game.jumpTime > .2;
    if (object.avoid === "slide") return game.slideTime > .16;
    return false;
  }

  function failRun() {
    if (game.revive) {
      game.revive = 0;
      game.bossDistance = 38;
      game.invulnerableUntil = game.elapsed + 2.5;
      game.boostUntil = Math.max(game.boostUntil, game.elapsed + 2.5);
      showToast("复活生效！继续跑！", 2200);
      return;
    }
    game.phase = "angel";
    game.angelTime = 0;
    game.frozenObjects = game.objects.slice();
    ui.drawButton.disabled = true;
    showToast("天使接引者正在赶来……", 2200);
  }

  function updateIntro(dt) {
    game.introTime += dt;
    if (game.introTime > 8.2) startRunning();
  }

  function updateRunning(dt) {
    game.elapsed += dt;
    game.speed = clamp(.21 + game.elapsed * .00115, .21, .36);
    const speedMultiplier = game.boostUntil > game.elapsed ? 1.62 : 1;
    game.distance += dt * (11 + game.elapsed * .035) * speedMultiplier;
    game.bossDistance -= dt * (.33 + game.elapsed * .0018);
    game.laneVisual = lerp(game.laneVisual, game.lane, 1 - Math.pow(.001, dt));
    game.jumpTime = Math.max(0, game.jumpTime - dt);
    game.slideTime = Math.max(0, game.slideTime - dt);
    game.shake = Math.max(0, game.shake - dt);
    game.flash = Math.max(0, game.flash - dt);

    game.spawnTimer -= dt * speedMultiplier;
    if (game.spawnTimer <= 0) {
      const roll = Math.random();
      if (roll < .43) spawnCoinTrail();
      else if (roll < .93) spawnObstacle();
      else spawnTicket();
      game.spawnTimer = clamp(.92 - game.elapsed * .003, .44, .92) * (.88 + Math.random() * .3);
    }

    game.projectileTimer -= dt;
    if (game.projectileTimer <= 0 && game.elapsed > 8) {
      spawnBossProjectile();
      game.projectileTimer = clamp(13 - game.elapsed * .025, 7, 13) + Math.random() * 2;
    }

    for (const object of game.objects) {
      object.z -= game.speed * dt * speedMultiplier;
      if (object.hit || object.z > .155 || object.z < -.12) continue;

      const sameLane = Math.abs(object.lane - game.laneVisual) < .42;
      const magnetic = object.type === "coin" && game.magnetUntil > game.elapsed && object.z < .36;

      if (object.type === "coin" && (sameLane || magnetic)) collectCoin(object);
      else if (object.type === "ticket" && sameLane) {
        object.hit = true;
        wallet.tickets += 1;
        saveWallet();
        showToast("捡到一张彩票！");
      } else if (!sameLane) {
        object.hit = true;
        if (object.type !== "coin" && object.type !== "ticket") game.bossDistance = clamp(game.bossDistance + 1.5, 0, 100);
      } else if (avoidSatisfied(object)) {
        object.hit = true;
        game.bossDistance = clamp(game.bossDistance + 3, 0, 100);
      } else if (object.type !== "coin" && object.type !== "ticket") {
        hitObstacle(object);
      }
    }

    game.objects = game.objects.filter(object => object.z > -.2 && !(object.hit && object.z < .05));
    game.bossDistance = clamp(game.bossDistance, 0, 100);
    if (game.bossDistance <= 0) failRun();

    const zoneIndex = Math.floor(game.distance / 430) % zones.length;
    if (zoneIndex !== game.lastZone) {
      game.lastZone = zoneIndex;
      if (game.distance > 20) showToast(`进入：${zones[zoneIndex].name}`);
    }
    updateUi();
  }

  function updateAngel(dt) {
    game.angelTime += dt;
    if (game.angelTime > 4.9 && game.phase === "angel") {
      game.phase = "result";
      ui.resultDistance.textContent = `${Math.floor(game.distance)}m`;
      ui.resultCoins.textContent = game.runCoins;
      ui.resultTickets.textContent = game.ticketsUsed;
      ui.resultOverlay.classList.remove("hidden");
      updateUi();
    }
  }

  function roadPoint(lane, z) {
    const progress = Math.pow(clamp(1 - z, 0, 1.2), 1.55);
    const halfWidth = lerp(32, W * .54, progress);
    return {
      x: W / 2 + lane * halfWidth * .58,
      y: HORIZON + progress * (ROAD_BOTTOM - HORIZON),
      scale: lerp(.1, 1.05, progress)
    };
  }

  function drawCampusBackground(zone, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 170);
    sky.addColorStop(0, zone.sky[0]);
    sky.addColorStop(1, zone.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,.58)";
    for (let i = 0; i < 5; i++) {
      const x = ((i * 118 - time * 8) % (W + 160)) - 80;
      ctx.beginPath();
      ctx.ellipse(x, 118 + (i % 2) * 24, 56, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = zone.accent;
    ctx.fillRect(18, 118, 118, 124);
    ctx.fillRect(W - 145, 100, 127, 142);
    ctx.fillStyle = "rgba(236,248,255,.88)";
    for (let y = 135; y < 218; y += 28) {
      for (const x of [34, 68, 102, W - 128, W - 94, W - 60]) ctx.fillRect(x, y, 20, 14);
    }

    ctx.fillStyle = zone.side;
    ctx.fillRect(0, HORIZON + 20, W, H - HORIZON);

    ctx.fillStyle = "rgba(24,70,45,.48)";
    for (let i = 0; i < 8; i++) {
      const x = i * 64 - 18;
      ctx.beginPath();
      ctx.arc(x, HORIZON + 28, 24 + (i % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(W / 2 - 32, HORIZON);
    ctx.lineTo(W / 2 + 32, HORIZON);
    ctx.lineTo(W + 70, H);
    ctx.lineTo(-70, H);
    ctx.closePath();
    ctx.fillStyle = zone.road;
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.52)";
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 22]);
    for (const laneLine of [-.5, .5]) {
      ctx.beginPath();
      const top = roadPoint(laneLine, 1);
      const bottom = roadPoint(laneLine, 0);
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(W / 2 - 42, HORIZON - 46, 84, 29);
    ctx.fillStyle = zone.accent;
    ctx.font = "900 13px Microsoft YaHei";
    ctx.textAlign = "center";
    ctx.fillText(zone.name, W / 2, HORIZON - 27);
  }

  function drawBrokenHouse() {
    const x = 106;
    const y = 205;
    ctx.save();
    ctx.fillStyle = "#5a4639";
    ctx.fillRect(x, y, 208, 178);
    ctx.fillStyle = "#342923";
    ctx.beginPath();
    ctx.moveTo(x - 24, y + 15);
    ctx.lineTo(x + 104, y - 68);
    ctx.lineTo(x + 232, y + 15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#8d6b50";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(x, y + 44);
    ctx.lineTo(x + 208, y + 83);
    ctx.moveTo(x + 34, y);
    ctx.lineTo(x + 14, y + 178);
    ctx.moveTo(x + 178, y);
    ctx.lineTo(x + 201, y + 178);
    ctx.stroke();
    ctx.fillStyle = "#10141b";
    ctx.fillRect(x + 70, y + 62, 76, 116);
    ctx.fillStyle = "#c85035";
    ctx.font = "900 15px Microsoft YaHei";
    ctx.textAlign = "center";
    ctx.fillText("废弃杂物房", x + 104, y + 40);
    ctx.restore();
  }

  function drawSprite(sprite, x, bottomY, height, options = {}) {
    if (!sprite) return;
    const ratio = sprite.width / sprite.height;
    const width = height * ratio;
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.translate(x, bottomY);
    ctx.rotate(options.rotation || 0);
    ctx.scale(options.flip ? -1 : 1, options.scaleY || 1);
    if (options.glow) {
      ctx.shadowColor = options.glow;
      ctx.shadowBlur = options.blur || 18;
    }
    ctx.drawImage(sprite, -width / 2, -height, width, height);
    ctx.restore();
  }

  function drawIntro() {
    const t = game.introTime;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#304d7a");
    sky.addColorStop(.46, "#92b8ca");
    sky.addColorStop(1, "#505d4a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#5b754c";
    ctx.fillRect(0, 380, W, 420);
    ctx.fillStyle = "#808a84";
    ctx.beginPath();
    ctx.moveTo(142, 374);
    ctx.lineTo(278, 374);
    ctx.lineTo(430, 800);
    ctx.lineTo(-10, 800);
    ctx.closePath();
    ctx.fill();
    drawBrokenHouse();

    const heroProgress = easeOutCubic((t - .6) / 2.2);
    const heroY = lerp(484, 670, heroProgress);
    const heroX = W / 2 + Math.sin(t * 5) * 4;
    const heroHeight = lerp(132, 220, heroProgress);
    drawSprite(sprites.hero, heroX, heroY, heroHeight);

    if (t > 2.7 && t < 4.6) {
      ctx.save();
      ctx.translate(heroX + 62, heroY - heroHeight + 20);
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#10162c";
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("😝", 0, 2);
      ctx.restore();
    }

    if (t > 3.7) {
      const villainProgress = easeOutCubic((t - 3.7) / 1.4);
      const villainY = lerp(482, 570, villainProgress);
      drawSprite(sprites.villain, 209, villainY, lerp(108, 160, villainProgress), { flip: true });
    }

    if (t > 5.1) {
      const wrenchProgress = clamp((t - 5.1) / 1.65, 0, 1);
      const wx = lerp(215, 380, wrenchProgress);
      const wy = lerp(438, 645, wrenchProgress) - Math.sin(wrenchProgress * Math.PI) * 120;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(wrenchProgress * 12);
      ctx.font = "54px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🔧", 0, 0);
      ctx.restore();
    }

    const captions = [
      [0, 2.6, "破屋里传来一阵响动……"],
      [2.6, 4.7, "陈坤：来追我呀！"],
      [4.7, 6.8, "反派：你给我站住！"],
      [6.8, 8.3, "准备——开跑！"]
    ];
    const caption = captions.find(([from, to]) => t >= from && t < to);
    if (caption) {
      ctx.fillStyle = "rgba(5,14,36,.78)";
      ctx.fillRect(46, 704, W - 92, 48);
      ctx.fillStyle = "white";
      ctx.font = "800 16px Microsoft YaHei";
      ctx.textAlign = "center";
      ctx.fillText(caption[2], W / 2, 735);
    }
  }

  function drawObject(object) {
    if (object.hit) return;
    const point = roadPoint(object.lane, object.z);
    const bob = Math.sin(game.elapsed * 5 + object.bob) * 5 * point.scale;
    ctx.save();
    ctx.translate(point.x, point.y + bob);

    if (object.type === "coin") {
      const radius = 15 * point.scale;
      const gradient = ctx.createRadialGradient(-radius * .3, -radius * .4, 2, 0, 0, radius);
      gradient.addColorStop(0, "#fffbd0");
      gradient.addColorStop(.35, "#ffd747");
      gradient.addColorStop(1, "#d78d00");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, -radius, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.lineWidth = Math.max(1, 2 * point.scale);
      ctx.stroke();
      ctx.fillStyle = "#9a6000";
      ctx.font = `${Math.max(7, 15 * point.scale)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("★", 0, -radius + 5 * point.scale);
    } else if (object.type === "ticket") {
      const width = 52 * point.scale;
      const height = 32 * point.scale;
      ctx.rotate(-.12);
      ctx.fillStyle = "#ff4770";
      ctx.fillRect(-width / 2, -height, width, height);
      ctx.strokeStyle = "#ffd85a";
      ctx.lineWidth = Math.max(1, 3 * point.scale);
      ctx.strokeRect(-width / 2 + 3, -height + 3, width - 6, height - 6);
      ctx.fillStyle = "white";
      ctx.font = `900 ${Math.max(7, 12 * point.scale)}px Microsoft YaHei`;
      ctx.textAlign = "center";
      ctx.fillText("彩票", 0, -height / 2 + 4 * point.scale);
    } else {
      const emoji = { desk: "🪑", puddle: "💦", banner: "🚧", cone: "⚠️", basketball: "🏀", wrench: "🔧" }[object.type];
      const size = Math.max(12, (object.type === "wrench" ? 58 : 66) * point.scale);
      if (object.type === "banner") {
        ctx.fillStyle = "#d44c3f";
        ctx.fillRect(-46 * point.scale, -70 * point.scale, 92 * point.scale, 18 * point.scale);
        ctx.fillStyle = "#78502c";
        ctx.fillRect(-47 * point.scale, -52 * point.scale, 5 * point.scale, 52 * point.scale);
        ctx.fillRect(42 * point.scale, -52 * point.scale, 5 * point.scale, 52 * point.scale);
      } else {
        if (object.type === "wrench") ctx.rotate((1 - object.z) * 10);
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(emoji, 0, 0);
      }
    }
    ctx.restore();
  }

  function drawBoss() {
    const proximity = 1 - game.bossDistance / 100;
    const bottomY = lerp(356, 575, proximity);
    const height = lerp(92, 195, proximity);
    drawSprite(sprites.villain, W / 2 + 20, bottomY, height, { alpha: .92, flip: true });
    if (game.bossDistance < 22) {
      ctx.fillStyle = `rgba(255,71,112,${.08 + Math.sin(game.elapsed * 9) * .04})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPlayer() {
    const jumpProgress = game.jumpTime > 0 ? 1 - game.jumpTime / .82 : 0;
    const lift = game.jumpTime > 0 ? Math.sin(jumpProgress * Math.PI) * 142 : 0;
    const slideScale = game.slideTime > 0 ? .58 : 1;
    const x = roadPoint(game.laneVisual, 0).x;
    const height = 205;
    const alpha = game.elapsed < game.invulnerableUntil && Math.floor(game.elapsed * 12) % 2 ? .5 : 1;

    if (game.boostUntil > game.elapsed) {
      ctx.save();
      ctx.strokeStyle = "rgba(101,246,232,.62)";
      ctx.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 54 + i * 34, 710 + i * 8);
        ctx.lineTo(x - 88 + i * 34, 770 + i * 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawSprite(sprites.hero, x, 728 - lift, height, {
      alpha,
      scaleY: slideScale,
      rotation: game.slideTime > 0 ? -.35 : 0,
      glow: game.boostUntil > game.elapsed ? "#65f6e8" : undefined,
      blur: 22
    });

    if (game.shield) {
      ctx.strokeStyle = "rgba(101,246,232,.72)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, 615 - lift, 76, 126, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawRunScene(showPlayer = true) {
    const zone = zones[Math.floor(game.distance / 430) % zones.length];
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - .5) * 12, (Math.random() - .5) * 8);
    drawCampusBackground(zone, game.elapsed);
    drawBoss();

    const ordered = game.objects.slice().sort((a, b) => b.z - a.z);
    for (const object of ordered) drawObject(object);
    if (showPlayer) drawPlayer();

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 2.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawAngelSequence() {
    drawRunScene(false);
    const t = game.angelTime;
    const arrival = easeOutCubic(t / 1.9);
    const ascend = clamp((t - 2.25) / 2.25, 0, 1);

    ctx.fillStyle = `rgba(235,247,255,${clamp(t / 3.5, 0, .64)})`;
    ctx.fillRect(0, 0, W, H);

    const angelY = lerp(-80, 520, arrival) - ascend * 400;
    const heroY = 730 - ascend * 440;
    const fade = 1 - clamp((t - 4.1) / .7, 0, 1);

    drawSprite(sprites.hero, 188, heroY, 185, { rotation: .5 - ascend * .45, alpha: fade, glow: "#bcecff", blur: 18 });
    drawSprite(sprites.angel, 252, angelY, 330, { alpha: fade, glow: "#fff2ae", blur: 24 });

    if (t > 1.4 && t < 3.8) {
      ctx.fillStyle = "rgba(7,18,45,.78)";
      ctx.fillRect(64, 680, W - 128, 46);
      ctx.fillStyle = "white";
      ctx.font = "800 15px Microsoft YaHei";
      ctx.textAlign = "center";
      ctx.fillText(t < 2.4 ? "天使：这局先到这里。" : "陈坤被温柔地接走了……", W / 2, 709);
    }
  }

  function drawLoading() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#173f76");
    gradient.addColorStop(1, "#07122d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.font = "900 28px Microsoft YaHei";
    ctx.fillText("陈坤快跑", W / 2, 360);
    ctx.font = "13px Microsoft YaHei";
    ctx.fillStyle = "#9fb0cd";
    ctx.fillText("正在整理校园跑道……", W / 2, 395);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    if (!sprites.hero) drawLoading();
    else if (game.phase === "menu") {
      game.introTime = 0;
      drawIntro();
    } else if (game.phase === "intro") drawIntro();
    else if (game.phase === "angel" || game.phase === "result") drawAngelSequence();
    else drawRunScene();
  }

  function frame(now) {
    const dt = Math.min(.034, (now - lastTime) / 1000 || 0);
    lastTime = now;
    if (game.phase === "intro") updateIntro(dt);
    else if (game.phase === "running") updateRunning(dt);
    else if (game.phase === "angel") updateAngel(dt);
    render();
    requestAnimationFrame(frame);
  }

  ui.startButton.addEventListener("click", () => {
    ui.startOverlay.classList.add("hidden");
    resetRun();
  });
  ui.restartButton.addEventListener("click", resetRun);
  ui.exchangeButton.addEventListener("click", exchangeTicket);
  ui.drawButton.addEventListener("click", drawLottery);

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      handleAction(button.dataset.action);
      canvas.focus();
    });
  });

  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (["arrowleft", "a"].includes(key)) moveLeft();
    else if (["arrowright", "d"].includes(key)) moveRight();
    else if (["arrowup", "w", " "].includes(key)) jump();
    else if (["arrowdown", "s"].includes(key)) slide();
    else return;
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener("pointerdown", event => {
    swipeStart = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", event => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) handleAction(dx > 0 ? "right" : "left");
    else handleAction(dy < 0 ? "jump" : "slide");
  });

  updateUi();
  requestAnimationFrame(frame);
  loadSprites().then(() => {
    updateUi();
  }).catch(error => {
    console.error(error);
    showToast("角色素材加载失败，请刷新页面", 5000);
  });
})();


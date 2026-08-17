#!/usr/bin/env node
/**
 * Replayable smoke test for the exported game.
 *
 *   pnpm smoke              # build + quick run (~20s of browser play)
 *   pnpm smoke -- --full    # same, but plays the whole 110s run to the result scene
 *   node scripts/smoke-game.mjs --skip-browser
 *
 * Phase 1 runs the shipped simulation headlessly (apps/web/lib/game/simulation.ts is
 * imported directly — Node strips the types) so gameplay rules are asserted without a GPU.
 * Phase 2 serves `apps/web/out` and drives a headless Chrome over CDP with zero
 * third-party dependencies (Node's global WebSocket).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outDir = path.join(repoRoot, "apps/web/out");
const full = process.argv.includes("--full");
const skipBrowser = process.argv.includes("--skip-browser");

let failures = 0;
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  if (!ok) failures += 1;
  return ok;
};

/* ── Phase 1 · simulation ────────────────────────────────────────────────── */

const runSimulation = async () => {
  console.log("\n[1/3] simulation");
  const sim = await import(
    path.join(repoRoot, "apps/web/lib/game/simulation.ts")
  );

  const level = sim.buildLevel();
  const itemKinds = new Set(level.items.map((item) => item.kind));
  check(
    "level: 5 collectible types present",
    itemKinds.size === sim.ITEM_KINDS.length,
    [...itemKinds].join(","),
  );
  check(
    "level: 4 obstacle families present",
    new Set(level.obstacles.map((o) => o.kind)).size === 4 &&
      level.pits.length > 0,
    `obstacles=${level.obstacles.length} pits=${level.pits.length} platforms=${level.platforms.length}`,
  );
  check("level: 4 checkpoints", level.checkpoints.length === 4);
  check(
    "level: 3 enemy zones",
    new Set(level.enemies.map((e) => e.zone)).size === 3,
    `${level.enemies.length} enemies`,
  );

  // Reference player: jumps over gaps/blocks and attacks what is in front.
  const policy = (world) => {
    const input = sim.emptyInput();
    const worldX = world.camera + world.playerX;
    const near = (x, min, max) => x - worldX > min && x - worldX < max;
    const pit = world.level.pits.find((entry) => near(entry.x, 8, 30));
    const block = world.level.obstacles.find(
      (entry) => entry.kind !== "falling" && near(entry.x, 10, 34),
    );
    const highItem = world.level.items.find(
      (entry) =>
        !entry.taken && near(entry.x, 6, 30) && entry.y < sim.GROUND_Y - 30,
    );
    const target = world.level.enemies.find(
      (entry) => !entry.defeated && near(entry.x, -6, 34),
    );
    const falling = world.level.obstacles.find(
      (entry) =>
        entry.kind === "falling" && !entry.spent && near(entry.x, -6, 34),
    );
    if (world.onGround && (pit || block || highItem)) input.jumpPressed = true;
    if (
      !world.onGround &&
      world.jumpsUsed < 2 &&
      world.velocityY > 20 &&
      (pit || highItem)
    )
      input.jumpPressed = true;
    if (target || falling) input.actionPressed = true;
    return input;
  };

  for (const character of ["tj", "ta"]) {
    const world = sim.createWorld(character);
    const zones = new Set();
    let frames = 0;
    while (!world.finished && frames < 60 * 200) {
      sim.stepWorld(world, 1 / 60, policy(world));
      zones.add(world.zone);
      world.events.length = 0;
      frames += 1;
    }
    const summary = sim.summarize(world);
    const label = `${character} (${summary.characterName})`;
    check(
      `${label}: run lasts 110s ±10s`,
      Math.abs(summary.seconds - 110) <= 10,
      `${summary.seconds}s`,
    );
    check(
      `${label}: reaches the finish line`,
      summary.complete,
      `progress ${(summary.progress * 100).toFixed(1)}%`,
    );
    check(
      `${label}: all three zones played`,
      zones.size === 3,
      [...zones].join("/"),
    );
    check(`${label}: finale cleared`, world.finaleCleared);
    check(
      `${label}: fever fires at least 3 times`,
      summary.feverCount >= 3,
      `${summary.feverCount}x`,
    );
    check(
      `${label}: collects items`,
      summary.items > 40,
      `${summary.items} items`,
    );
    check(
      `${label}: grade is A or better`,
      ["S", "A"].includes(summary.grade),
      `${summary.grade} / ${summary.score}`,
    );
    check(
      `${label}: score is finite`,
      Number.isFinite(summary.score) && summary.score > 0,
    );
  }

  // Doing nothing must still finish the run — there is no game over (K14).
  const idle = sim.createWorld("tj");
  let frames = 0;
  while (!idle.finished && frames < 60 * 200) {
    sim.stepWorld(idle, 1 / 60, sim.emptyInput());
    idle.events.length = 0;
    frames += 1;
  }
  const idleSummary = sim.summarize(idle);
  check(
    "idle run still finishes (no game over)",
    idle.finished && idleSummary.complete,
  );
  check(
    "idle run grades lower than a played run",
    idleSummary.grade === "C",
    idleSummary.grade,
  );
};

/* ── Phase 2 · exported bundle ───────────────────────────────────────────── */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const serve = () =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      let filePath = path.join(outDir, decodeURIComponent(url.pathname));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        response.writeHead(404, { "content-type": "text/html" });
        response.end(fs.readFileSync(path.join(outDir, "404.html")));
        return;
      }
      response.writeHead(200, {
        "content-type":
          MIME[path.extname(filePath)] ?? "application/octet-stream",
      });
      response.end(fs.readFileSync(filePath));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const checkBundle = () => {
  console.log("\n[2/3] exported bundle");
  check("out/ exists", fs.existsSync(outDir));
  for (const file of [
    "index.html",
    "404.html",
    ".nojekyll",
    "robots.txt",
    "sitemap.xml",
    "assets/atlas-game.png",
    "assets/atlas-game.json",
  ]) {
    check(`out/${file}`, fs.existsSync(path.join(outDir, file)));
  }

  const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  check("index.html carries the game title", html.includes("LET ME LOVE YOU"));

  // Literal regression: the omniseed template shell must be gone from the *output*,
  // not just from the sources.
  const removed = [
    "Hello World",
    "DesignSystemProvider",
    "swiper",
    "next-themes",
  ];
  const bundleText = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (/\.(html|js|css)$/.test(entry.name))
        bundleText.push(fs.readFileSync(entryPath, "utf8"));
    }
  };
  walk(outDir);
  const joined = bundleText.join("\n");
  for (const literal of removed) {
    check(
      `removed literal absent from bundle: "${literal}"`,
      !joined.includes(literal),
    );
  }

  const atlas = JSON.parse(
    fs.readFileSync(path.join(outDir, "assets/atlas-game.json"), "utf8"),
  );
  check("atlas ships 100 frames", Object.keys(atlas.frames).length === 100);
  const size = Object.keys(atlas.frames).length;
  const png = fs.readFileSync(path.join(outDir, "assets/atlas-game.png"));
  check(
    "atlas png is a real PNG",
    png.subarray(0, 4).toString("hex") === "89504e47",
  );
  let imageBytes = 0;
  for (const file of fs.readdirSync(path.join(outDir, "assets"))) {
    imageBytes += fs.statSync(path.join(outDir, "assets", file)).size;
  }
  check(
    "image budget ≤ 132 KB",
    imageBytes <= 132 * 1024,
    `${imageBytes} B for ${size} frames`,
  );
  check(
    "atlas sha256 matches the committed source",
    createHash("sha256").update(png).digest("hex") ===
      createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(repoRoot, "apps/web/public/assets/atlas-game.png"),
          ),
        )
        .digest("hex"),
  );
};

/* ── Phase 3 · headless Chrome ───────────────────────────────────────────── */

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.consoleErrors.push(
          message.params.exceptionDetails?.exception?.description ??
            "exception",
        );
      }
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error"
      ) {
        this.consoleErrors.push(
          message.params.args
            .map((arg) => arg.value ?? arg.description)
            .join(" "),
        );
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? "eval failed",
      );
    }
    return result.result.value;
  }
}

const runBrowser = async () => {
  console.log("\n[3/3] headless browser");
  const chrome = CHROME_CANDIDATES.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!chrome) {
    check("chrome available", false, "no Chrome/Chromium binary found");
    return;
  }

  const server = await serve();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fma-smoke-"));
  const debugPort = 9200 + Math.floor(Math.random() * 400);

  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1280,860",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const cleanup = async () => {
    browser.kill();
    server.close();
    // Chrome unlinks its profile asynchronously; a failed cleanup is not a test failure.
    await sleep(400);
    try {
      fs.rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch {
      /* temp dir stays behind */
    }
  };

  try {
    let version = null;
    for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
      try {
        version = await (
          await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        ).json();
      } catch {
        await sleep(250);
      }
    }
    if (
      !check(
        "chrome devtools reachable",
        Boolean(version),
        version?.Browser ?? "",
      )
    )
      return;

    // Static probes first: no env, no app code involved.
    for (const [route, expected] of [
      ["/", 200],
      ["/assets/atlas-game.json", 200],
      ["/assets/atlas-game.png", 200],
      ["/robots.txt", 200],
      ["/sitemap.xml", 200],
    ]) {
      const response = await fetch(`${origin}${route}`);
      check(
        `GET ${route} → ${expected}`,
        response.status === expected,
        String(response.status),
      );
    }

    const targets = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    ).json();
    const target = targets.find((entry) => entry.type === "page");
    await fetch(`http://127.0.0.1:${debugPort}/json/activate/${target.id}`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    const cdp = new Cdp(socket);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: `${origin}/` });
    await sleep(1500);

    check(
      "document title",
      (await cdp.evaluate("document.title")).includes("LET ME LOVE YOU"),
    );

    // Wait for the atlas to load (the CTA is disabled while loading).
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      ready = await cdp.evaluate(
        `!!document.querySelector('.scene-title .primary-button:not([disabled])')`,
      );
      if (!ready) await sleep(250);
    }
    check("title scene ready after atlas load", ready);
    check(
      "load note reports the frame contract",
      (
        await cdp.evaluate("document.querySelector('.load-note').textContent")
      ).includes("100"),
    );

    await cdp.evaluate(
      "document.querySelector('.scene-title .primary-button').click()",
    );
    await sleep(300);
    check(
      "title → select",
      await cdp.evaluate("!document.querySelector('.scene-select').hidden"),
    );

    await cdp.evaluate("document.querySelector('.lane-ta').click()");
    await sleep(150);
    check(
      "character selection persists",
      await cdp.evaluate(
        "document.querySelector('.lane-ta').getAttribute('aria-pressed') === 'true'",
      ),
    );
    check(
      "localStorage keeps the last runner",
      (await cdp.evaluate("localStorage.getItem('fma.v1.lastChar')")) === "ta",
    );

    await cdp.evaluate(
      "document.querySelector('.select-footer .primary-button').click()",
    );
    await sleep(1200);
    check(
      "select → play",
      await cdp.evaluate("!document.querySelector('.scene-play').hidden"),
    );

    const canvasSignature = `(() => {
      const canvas = document.querySelector('.canvas-wrap canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, distinct = new Set();
      for (let i = 0; i < data.length; i += 40) { sum += data[i]; distinct.add(data[i] + ',' + data[i+1] + ',' + data[i+2]); }
      return { sum, colors: distinct.size, width: canvas.width, height: canvas.height };
    })()`;
    const first = await cdp.evaluate(canvasSignature);
    check("canvas is 320x180", first.width === 320 && first.height === 180);
    check(
      "canvas renders real pixels",
      first.colors > 6,
      `${first.colors} colours`,
    );

    // Real input: pointer on the touch deck, keys through the CDP input domain.
    await cdp.evaluate(`
      document.querySelector('.jump-button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.querySelector('.action-button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      code: "Space",
      key: " ",
      windowsVirtualKeyCode: 32,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      code: "Space",
      key: " ",
    });
    await sleep(400);
    const second = await cdp.evaluate(canvasSignature);
    check("canvas animates between frames", second.sum !== first.sum);

    const readHud = `(() => {
      const strong = [...document.querySelectorAll('.hud-band strong')].map((node) => node.textContent);
      return {
        score: Number(strong[0]),
        combo: strong[1],
        remaining: Number((strong[2] || '').replace('%','')),
        zone: document.querySelector('.stage-id strong').textContent,
      };
    })()`;

    await sleep(full ? 6000 : 5000);
    const midHud = await cdp.evaluate(readHud);
    check(
      "distance needle advances",
      midHud.remaining < 100,
      `${midHud.remaining}% left`,
    );
    check("score accumulates", midHud.score > 0, String(midHud.score));

    if (full) {
      // Whole 110s run, ending on the result scene.
      for (let elapsed = 0; elapsed < 115; elapsed += 1) {
        await cdp.evaluate(`(() => {
          for (const selector of ['.jump-button', '.action-button']) {
            const node = document.querySelector(selector);
            if (node) node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          }
          return true;
        })()`);
        const done = await cdp.evaluate(
          "!document.querySelector('.scene-result').hidden",
        );
        if (done) break;
        await sleep(1000);
      }
      const result = await cdp.evaluate(`(() => ({
        hidden: document.querySelector('.scene-result').hidden,
        grade: document.querySelector('.grade-stamp strong').textContent,
        stamp: document.querySelector('.grade-stamp span').textContent,
        score: document.querySelector('.setlist-stats dd').textContent,
        best: localStorage.getItem('fma.v1.best'),
      }))()`);
      check(
        "play → result after the full run",
        result.hidden === false,
        JSON.stringify(result),
      );
      check(
        "result shows a grade",
        ["S", "A", "B", "C"].includes(result.grade),
        result.grade,
      );
      check(
        "result shows a score",
        /\d{6}/.test(result.score ?? ""),
        result.score,
      );
      check(
        "best score is persisted",
        Number(result.best) > 0,
        String(result.best),
      );
    } else {
      const zoneSeen = midHud.zone;
      check("zone label present", Boolean(zoneSeen), zoneSeen);
      await cdp.evaluate("document.querySelector('.quit-button').click()");
      await sleep(300);
      check(
        "play → title on quit",
        await cdp.evaluate("!document.querySelector('.scene-title').hidden"),
      );
    }

    check(
      "no console errors",
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.slice(0, 3).join(" | "),
    );
    socket.close();
  } finally {
    await cleanup();
  }
};

await runSimulation();
checkBundle();
if (!skipBrowser) await runBrowser();

console.log(`\n${failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);

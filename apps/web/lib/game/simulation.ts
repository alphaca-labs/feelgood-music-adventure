/**
 * Pure gameplay simulation for "LET ME LOVE YOU — 필굿뮤직 어드벤처".
 *
 * This module has NO imports on purpose:
 *  - the browser renderer and the React shell import it as `./simulation`
 *  - `scripts/smoke-game.mjs` imports the same file directly (Node strips the types),
 *    so the headless smoke run executes the *shipped* rules, not a copy of them.
 *
 * Keep it free of DOM/Node APIs and of non-erasable TypeScript syntax (no enums,
 * no parameter properties) so both consumers keep working.
 */

/* ── Canvas / timeline contract (planning spec §3, §5) ───────────────────── */

export const LOGICAL_WIDTH = 320;
export const LOGICAL_HEIGHT = 180;
export const TILE = 16;
/** Top edge of the ground band. */
export const GROUND_Y = 148;
/** Where the runner sits on screen; world x = camera + screen x. */
export const PLAYER_HOME_X = 68;
export const PLAYER_MIN_X = 28;
export const PLAYER_MAX_X = 196;

/** Auto-scroll speed in dots per second. 60 × 110s = 6600 dots (spec §3). */
export const SCROLL_SPEED = 60;
export const RUN_SECONDS = 110;
export const TOTAL_DISTANCE = SCROLL_SPEED * RUN_SECONDS;

export type ZoneId = "jungle" | "city" | "stage";

export type ZoneSpec = {
  id: ZoneId;
  label: string;
  start: number;
  end: number;
};

/** 0–20s jungle, 20–70s city, 70–105s stage, 105–110s finale (inside the stage zone). */
export const ZONES: ZoneSpec[] = [
  { id: "jungle", label: "정글 입구", start: 0, end: 1200 },
  { id: "city", label: "도시 거리", start: 1200, end: 4200 },
  { id: "stage", label: "무대 진입", start: 4200, end: TOTAL_DISTANCE },
];

export const FINALE_START = 6300;
export const FINALE_OBSTACLE_X = 6444;

/** 구간 시작 3개 + 마무리 직전 1개 (decision E). */
export const CHECKPOINTS = [0, 1200, 4200, FINALE_START];

/* ── Physics / feel ─────────────────────────────────────────────────────── */

export const GRAVITY = 620;
export const JUMP_VELOCITY = 250;
export const DOUBLE_JUMP_VELOCITY = 230;
export const MAX_FALL_SPEED = 480;
/** Input forgiveness (spec §8 B5/B6). */
export const COYOTE_MS = 100;
export const JUMP_BUFFER_MS = 100;

export const PLAYER_HALF_WIDTH = 10;
export const PLAYER_HEIGHT = 34;

/** Combo / fever (decision D). */
export const COMBO_WINDOW_MS = 2000;
export const FEVER_THRESHOLD = 10;
export const FEVER_MS = 5000;
export const MULTIPLIER_MAX = 5;

export const SCORE_ITEM = 60;
export const SCORE_ENEMY = 100;
export const SCORE_ZONE_CLEAR = 800;
export const SCORE_FINALE = 1500;

/** A hit never ends the run (K14); it rewinds, but never past the last checkpoint. */
export const HAZARD_REWIND = 32;
export const PIT_REWIND = 64;
export const INVULNERABLE_MS = 1200;
/** How fast the camera closes the gap after a rewind. */
export const RECOVERY_SCROLL_SCALE = 1.4;

export type CharacterId = "tj" | "ta";

export type CharacterSpec = {
  id: CharacterId;
  name: string;
  tag: string;
  description: string;
  /** Lateral nudge speed in dots/second. */
  nudgeSpeed: number;
  jumpScale: number;
  gravityScale: number;
  /** Horizontal reach of the short attack. */
  attackReach: number;
  attackCooldownMs: number;
  /** Fever charge weight — 윤미래's fever builds faster. */
  comboGain: number;
};

export const CHARACTERS: Record<CharacterId, CharacterSpec> = {
  tj: {
    id: "tj",
    name: "타이거 JK",
    tag: "POWER RUN",
    description: "속도감 있는 달리기와 강한 액션 이펙트",
    nudgeSpeed: 64,
    jumpScale: 1,
    gravityScale: 1,
    attackReach: 34,
    attackCooldownMs: 300,
    comboGain: 1,
  },
  ta: {
    id: "ta",
    name: "윤미래",
    tag: "LIGHT JUMP",
    description: "가벼운 점프와 피버 보컬 연출",
    nudgeSpeed: 48,
    jumpScale: 1.14,
    gravityScale: 0.88,
    attackReach: 24,
    attackCooldownMs: 400,
    comboGain: 1.25,
  },
};

export const ITEM_KINDS = ["beat", "cap", "mic", "hoodie", "logo"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemEntity = {
  type: "item";
  kind: ItemKind;
  x: number;
  y: number;
  taken: boolean;
};

export type EnemyEntity = {
  type: "enemy";
  zone: ZoneId;
  x: number;
  y: number;
  /** Horizontal patrol amplitude in dots (0 = static). */
  sway: number;
  defeated: boolean;
};

export type ObstacleEntity = {
  type: "obstacle";
  kind: "case" | "cable" | "falling" | "large";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Falling props stay parked until the camera gets close. */
  triggerX?: number;
  spent: boolean;
};

export type PlatformEntity = {
  type: "platform";
  x: number;
  y: number;
  width: number;
  /** Vertical bob amplitude. */
  bob: number;
};

export type PitEntity = { type: "pit"; x: number; width: number };
export type PropEntity = { type: "prop"; frame: string; x: number; y: number };
export type CheckpointEntity = {
  type: "checkpoint";
  x: number;
  index: number;
  reached: boolean;
};

export type Level = {
  items: ItemEntity[];
  enemies: EnemyEntity[];
  obstacles: ObstacleEntity[];
  platforms: PlatformEntity[];
  pits: PitEntity[];
  props: PropEntity[];
  checkpoints: CheckpointEntity[];
};

/* ── Deterministic level ────────────────────────────────────────────────── */

/** Small xorshift so every run is identical and the smoke test is reproducible. */
const createRandom = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
};

const itemArc = (
  items: ItemEntity[],
  startX: number,
  count: number,
  kind: ItemKind,
  peak: number,
) => {
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const lift = Math.sin(t * Math.PI) * peak;
    items.push({
      type: "item",
      kind,
      x: startX + index * 16,
      y: GROUND_Y - 24 - lift,
      taken: false,
    });
  }
};

/**
 * Collectible run that reliably charges one fever (needs {@link FEVER_THRESHOLD}
 * pickups inside the {@link COMBO_WINDOW_MS} window; 16 dots ≈ 0.27s apart).
 */
const feverRun = (items: ItemEntity[], startX: number, kind: ItemKind) => {
  for (let index = 0; index < 13; index += 1) {
    items.push({
      type: "item",
      kind,
      x: startX + index * 16,
      y: GROUND_Y - 28 - Math.sin(index * 0.7) * 18,
      taken: false,
    });
  }
};

export const buildLevel = (): Level => {
  const random = createRandom(0x5eed_1e7);
  const level: Level = {
    items: [],
    enemies: [],
    obstacles: [],
    platforms: [],
    pits: [],
    props: [],
    checkpoints: CHECKPOINTS.map((x, index) => ({
      type: "checkpoint",
      x,
      index,
      reached: false,
    })),
  };

  const zoneOf = (x: number): ZoneId =>
    x < ZONES[1].start ? "jungle" : x < ZONES[2].start ? "city" : "stage";

  // ── Zone 1 · jungle (0–1200): jump tutorial, low obstacles, first pickups.
  for (let x = 220; x < 1160; x += 150) {
    const roll = random();
    if (roll < 0.45) {
      level.obstacles.push({
        type: "obstacle",
        kind: "case",
        x,
        y: GROUND_Y,
        width: 26,
        height: 26,
        spent: false,
      });
      itemArc(level.items, x - 20, 3, "beat", 34);
    } else {
      level.pits.push({ type: "pit", x, width: 22 });
      itemArc(level.items, x - 8, 3, "cap", 40);
    }
    if (x > 600 && roll > 0.6) {
      level.enemies.push({
        type: "enemy",
        zone: "jungle",
        x: x + 74,
        y: GROUND_Y,
        sway: 10,
        defeated: false,
      });
    }
    level.props.push({
      type: "prop",
      frame: "prop_frond",
      x: x + 60,
      y: GROUND_Y,
    });
  }

  // ── Zone 2 · city (1200–4200): the long middle. Everything is in play here.
  for (let x = 1290; x < 4160; x += 132) {
    const roll = random();
    if (roll < 0.3) {
      level.pits.push({ type: "pit", x, width: 26 });
      level.platforms.push({
        type: "platform",
        x: x + 2,
        y: GROUND_Y - 42,
        width: 26,
        bob: 8,
      });
      itemArc(level.items, x - 2, 3, "mic", 12);
    } else if (roll < 0.62) {
      level.obstacles.push({
        type: "obstacle",
        kind: "case",
        x,
        y: GROUND_Y,
        width: 26,
        height: 26,
        spent: false,
      });
      itemArc(level.items, x - 24, 3, "hoodie", 38);
    } else {
      level.obstacles.push({
        type: "obstacle",
        kind: "falling",
        x,
        y: 40,
        width: 22,
        height: 24,
        triggerX: x - 150,
        spent: false,
      });
      itemArc(level.items, x + 28, 3, "beat", 26);
    }
    if (roll > 0.34) {
      level.enemies.push({
        type: "enemy",
        zone: "city",
        x: x + 66,
        y: GROUND_Y,
        sway: 14,
        defeated: false,
      });
    }
  }
  feverRun(level.items, 1980, "logo");
  feverRun(level.items, 3380, "cap");

  // ── Zone 3 · stage (4200–6300): denser, fever-forward.
  for (let x = 4290; x < 6250; x += 118) {
    const roll = random();
    if (roll < 0.34) {
      level.obstacles.push({
        type: "obstacle",
        kind: "cable",
        x,
        y: GROUND_Y,
        width: 28,
        height: 18,
        spent: false,
      });
      itemArc(level.items, x - 22, 3, "mic", 40);
    } else if (roll < 0.66) {
      level.pits.push({ type: "pit", x, width: 24 });
      itemArc(level.items, x - 4, 3, "logo", 34);
    } else {
      level.obstacles.push({
        type: "obstacle",
        kind: "case",
        x,
        y: GROUND_Y,
        width: 26,
        height: 26,
        spent: false,
      });
      itemArc(level.items, x + 26, 3, "hoodie", 30);
    }
    level.enemies.push({
      type: "enemy",
      zone: "stage",
      x: x + 60,
      y: GROUND_Y,
      sway: 18,
      defeated: false,
    });
    if (x % 236 < 118) {
      level.props.push({
        type: "prop",
        frame: "prop_speaker",
        x: x + 90,
        y: GROUND_Y,
      });
    }
  }
  feverRun(level.items, 4620, "beat");
  feverRun(level.items, 5620, "mic");

  // ── Finale (6300–6600): clean runway, one large obstacle, finish line.
  level.obstacles.push({
    type: "obstacle",
    kind: "large",
    x: FINALE_OBSTACLE_X,
    y: GROUND_Y,
    // 96px sprite, but only the lower rig is lethal so a single jump clears it.
    width: 62,
    height: 34,
    spent: false,
  });
  itemArc(level.items, FINALE_OBSTACLE_X - 44, 3, "logo", 44);
  itemArc(level.items, FINALE_OBSTACLE_X + 60, 4, "logo", 30);

  level.items.sort((a, b) => a.x - b.x);
  level.enemies = level.enemies.filter(
    (enemy) => zoneOf(enemy.x) === enemy.zone,
  );
  return level;
};

/* ── World state ────────────────────────────────────────────────────────── */

export type InputState = {
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  actionPressed: boolean;
};

export const emptyInput = (): InputState => ({
  left: false,
  right: false,
  jumpPressed: false,
  actionPressed: false,
});

export type GameEvent =
  | { kind: "item"; x: number; y: number; item: ItemKind }
  | { kind: "enemy"; x: number; y: number }
  | { kind: "jump"; double: boolean }
  | { kind: "attack" }
  | { kind: "fever-start" }
  | { kind: "fever-end" }
  | { kind: "hit"; reason: "hazard" | "pit" }
  | { kind: "checkpoint"; index: number }
  | { kind: "zone"; zone: ZoneId }
  | { kind: "finale-cleared" }
  | { kind: "finished" };

export type World = {
  character: CharacterSpec;
  level: Level;
  /** Seconds elapsed inside the run. */
  time: number;
  camera: number;
  /** Screen-space x of the runner. */
  playerX: number;
  playerY: number;
  velocityY: number;
  onGround: boolean;
  jumpsUsed: number;
  coyoteMs: number;
  bufferMs: number;
  attackMs: number;
  attackCooldownMs: number;
  invulnerableMs: number;
  shakeMs: number;
  combo: number;
  comboCharge: number;
  comboTimerMs: number;
  maxCombo: number;
  fever: boolean;
  feverMs: number;
  feverCount: number;
  score: number;
  items: number;
  enemiesCleared: number;
  hits: number;
  lastCheckpoint: number;
  zone: ZoneId;
  finaleCleared: boolean;
  finished: boolean;
  events: GameEvent[];
};

export const createWorld = (
  characterId: CharacterId,
  level?: Level,
): World => ({
  character: CHARACTERS[characterId],
  level: level ?? buildLevel(),
  time: 0,
  camera: 0,
  playerX: PLAYER_HOME_X,
  playerY: GROUND_Y,
  velocityY: 0,
  onGround: true,
  jumpsUsed: 0,
  coyoteMs: COYOTE_MS,
  bufferMs: 0,
  attackMs: 0,
  attackCooldownMs: 0,
  invulnerableMs: 0,
  shakeMs: 0,
  combo: 0,
  comboCharge: 0,
  comboTimerMs: 0,
  maxCombo: 0,
  fever: false,
  feverMs: 0,
  feverCount: 0,
  score: 0,
  items: 0,
  enemiesCleared: 0,
  hits: 0,
  lastCheckpoint: 0,
  zone: "jungle",
  finaleCleared: false,
  finished: false,
  events: [],
});

export const multiplierOf = (combo: number) =>
  Math.max(1, Math.min(MULTIPLIER_MAX, 1 + Math.floor(combo / 5)));

export const zoneAt = (x: number): ZoneId => {
  if (x < ZONES[1].start) return "jungle";
  if (x < ZONES[2].start) return "city";
  return "stage";
};

export const zoneLabel = (zone: ZoneId) =>
  ZONES.find((entry) => entry.id === zone)?.label ?? "";

/** Remaining distance as 0–1, used by the HUD needle. */
export const remainingRatio = (world: World) =>
  Math.max(0, Math.min(1, 1 - world.camera / TOTAL_DISTANCE));

export const isOverPit = (level: Level, worldX: number) =>
  level.pits.some((pit) => worldX > pit.x && worldX < pit.x + pit.width);

const overlaps = (
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

const award = (world: World, base: number) => {
  const gain = Math.round(
    base * multiplierOf(world.combo) * (world.fever ? 1.5 : 1),
  );
  world.score += gain;
  return gain;
};

const bumpCombo = (world: World) => {
  world.comboCharge += world.character.comboGain;
  world.combo = Math.floor(world.comboCharge);
  world.comboTimerMs = COMBO_WINDOW_MS;
  world.maxCombo = Math.max(world.maxCombo, world.combo);
  if (!world.fever && world.combo >= FEVER_THRESHOLD) {
    world.fever = true;
    world.feverMs = FEVER_MS;
    world.feverCount += 1;
    world.events.push({ kind: "fever-start" });
  }
};

const breakCombo = (world: World) => {
  world.combo = 0;
  world.comboCharge = 0;
  world.comboTimerMs = 0;
};

const rewind = (world: World, distance: number) => {
  world.camera = Math.max(world.lastCheckpoint, world.camera - distance);
  world.playerX = PLAYER_HOME_X;
  world.playerY = GROUND_Y;
  world.velocityY = 0;
  world.onGround = true;
  world.jumpsUsed = 0;
  world.invulnerableMs = INVULNERABLE_MS;
  world.shakeMs = 260;
  world.hits += 1;
  breakCombo(world);
  if (world.fever) {
    world.fever = false;
    world.feverMs = 0;
    world.events.push({ kind: "fever-end" });
  }
};

/**
 * Advance the world by `dt` seconds. Deterministic: the same input sequence always
 * produces the same run, which is what `scripts/smoke-game.mjs` asserts.
 */
export const stepWorld = (world: World, dt: number, input: InputState) => {
  if (world.finished) return world;

  const stepDt = Math.min(dt, 1 / 30);
  const ms = stepDt * 1000;
  const character = world.character;

  world.time += stepDt;
  // The camera never runs ahead of the 60 dots/s pace line, but it catches up after a
  // rewind — otherwise a single hit would make the 110s / 6600 dot budget unreachable
  // and "완주" would demand a flawless run (K20: difficulty stays forgiving).
  const pace = SCROLL_SPEED * world.time;
  const behind = pace - world.camera;
  const speed = SCROLL_SPEED * (behind > 2 ? RECOVERY_SCROLL_SCALE : 1);
  world.camera = Math.min(pace, world.camera + speed * stepDt);

  /* timers */
  world.comboTimerMs = Math.max(0, world.comboTimerMs - ms);
  if (world.comboTimerMs === 0 && world.combo > 0 && !world.fever)
    breakCombo(world);
  if (world.fever) {
    world.feverMs -= ms;
    if (world.feverMs <= 0) {
      world.fever = false;
      world.feverMs = 0;
      breakCombo(world);
      world.events.push({ kind: "fever-end" });
    }
  }
  world.attackMs = Math.max(0, world.attackMs - ms);
  world.attackCooldownMs = Math.max(0, world.attackCooldownMs - ms);
  world.invulnerableMs = Math.max(0, world.invulnerableMs - ms);
  world.shakeMs = Math.max(0, world.shakeMs - ms);

  /* lateral nudge (semi-automatic scroll, decision F) */
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  world.playerX += direction * character.nudgeSpeed * stepDt;
  // Drift back to the home mark so the camera never loses the runner.
  world.playerX += (PLAYER_HOME_X - world.playerX) * Math.min(1, stepDt * 0.9);
  world.playerX = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, world.playerX));

  /* jump with buffer + coyote time */
  if (input.jumpPressed) world.bufferMs = JUMP_BUFFER_MS;
  world.bufferMs = Math.max(0, world.bufferMs - ms);
  const canGroundJump = world.onGround || world.coyoteMs > 0;
  if (world.bufferMs > 0 && (canGroundJump || world.jumpsUsed < 2)) {
    const double = !canGroundJump;
    world.velocityY =
      -(double ? DOUBLE_JUMP_VELOCITY : JUMP_VELOCITY) * character.jumpScale;
    world.jumpsUsed = double ? 2 : 1;
    world.onGround = false;
    world.coyoteMs = 0;
    world.bufferMs = 0;
    world.events.push({ kind: "jump", double });
  }

  /* attack */
  if (input.actionPressed && world.attackCooldownMs === 0) {
    world.attackMs = 220;
    world.attackCooldownMs = character.attackCooldownMs;
    world.events.push({ kind: "attack" });
  }

  /* gravity */
  world.velocityY = Math.min(
    MAX_FALL_SPEED,
    world.velocityY + GRAVITY * character.gravityScale * stepDt,
  );
  world.playerY += world.velocityY * stepDt;

  const worldX = world.camera + world.playerX;
  const feetLeft = worldX - PLAYER_HALF_WIDTH;
  const playerTop = world.playerY - PLAYER_HEIGHT;

  /* ground / platform resolution */
  let supportY: number | null = isOverPit(world.level, worldX)
    ? null
    : GROUND_Y;
  for (const platform of world.level.platforms) {
    const platformY =
      platform.y + Math.sin(world.time * 1.6 + platform.x) * platform.bob;
    const withinX =
      worldX > platform.x - 4 && worldX < platform.x + platform.width + 4;
    const falling = world.velocityY >= 0;
    const crossing =
      world.playerY >= platformY - 6 && world.playerY <= platformY + 14;
    if (withinX && falling && crossing) {
      supportY = supportY === null ? platformY : Math.min(supportY, platformY);
    }
  }

  if (supportY !== null && world.playerY >= supportY && world.velocityY >= 0) {
    world.playerY = supportY;
    world.velocityY = 0;
    if (!world.onGround) world.jumpsUsed = 0;
    world.onGround = true;
    world.coyoteMs = COYOTE_MS;
  } else {
    if (world.onGround) world.coyoteMs = COYOTE_MS;
    world.onGround = false;
    world.coyoteMs = Math.max(0, world.coyoteMs - ms);
  }

  /* pit fall — never past the last checkpoint (decision E, K14: no game over) */
  if (world.playerY > LOGICAL_HEIGHT + 20) {
    rewind(world, PIT_REWIND);
    world.events.push({ kind: "hit", reason: "pit" });
  }

  /* items */
  for (const item of world.level.items) {
    if (item.taken) continue;
    if (item.x < worldX - 60) continue;
    if (item.x > worldX + 60) break;
    if (
      overlaps(
        feetLeft,
        playerTop,
        PLAYER_HALF_WIDTH * 2,
        PLAYER_HEIGHT,
        item.x - 8,
        item.y - 16,
        16,
        16,
      )
    ) {
      item.taken = true;
      world.items += 1;
      bumpCombo(world);
      award(world, SCORE_ITEM);
      world.events.push({
        kind: "item",
        x: item.x,
        y: item.y,
        item: item.kind,
      });
    }
  }

  /* enemies — attack or stomp clears them, contact rewinds */
  for (const enemy of world.level.enemies) {
    if (enemy.defeated) continue;
    const enemyX = enemy.x + Math.sin(world.time * 2.2 + enemy.x) * enemy.sway;
    if (Math.abs(enemyX - worldX) > 90) continue;
    const box = { x: enemyX - 12, y: enemy.y - 26, w: 24, h: 26 };

    const attacking = world.attackMs > 0;
    if (
      attacking &&
      overlaps(
        worldX - 4,
        playerTop,
        character.attackReach,
        PLAYER_HEIGHT,
        box.x,
        box.y,
        box.w,
        box.h,
      )
    ) {
      enemy.defeated = true;
      world.enemiesCleared += 1;
      bumpCombo(world);
      award(world, SCORE_ENEMY);
      world.events.push({ kind: "enemy", x: enemyX, y: enemy.y });
      continue;
    }

    const hitting = overlaps(
      feetLeft,
      playerTop,
      PLAYER_HALF_WIDTH * 2,
      PLAYER_HEIGHT,
      box.x,
      box.y,
      box.w,
      box.h,
    );
    if (!hitting) continue;

    const stomping = world.velocityY > 40 && world.playerY < enemy.y - 8;
    if (stomping) {
      enemy.defeated = true;
      world.enemiesCleared += 1;
      world.velocityY = -JUMP_VELOCITY * 0.7;
      bumpCombo(world);
      award(world, SCORE_ENEMY);
      world.events.push({ kind: "enemy", x: enemyX, y: enemy.y });
      continue;
    }
    if (world.invulnerableMs > 0 || world.fever) continue;
    rewind(world, HAZARD_REWIND);
    world.events.push({ kind: "hit", reason: "hazard" });
  }

  /* obstacles */
  for (const obstacle of world.level.obstacles) {
    if (Math.abs(obstacle.x - worldX) > 140) continue;
    let top = obstacle.y - obstacle.height;
    if (obstacle.kind === "falling") {
      const trigger = obstacle.triggerX ?? obstacle.x;
      if (world.camera < trigger) continue;
      const fallen = Math.min(
        GROUND_Y - obstacle.y,
        (world.camera - trigger) * 1.5,
      );
      top = obstacle.y + fallen - obstacle.height;
    }
    const hitting = overlaps(
      feetLeft,
      playerTop,
      PLAYER_HALF_WIDTH * 2,
      PLAYER_HEIGHT,
      obstacle.x - obstacle.width / 2,
      top,
      obstacle.width,
      obstacle.height,
    );
    if (!hitting) continue;
    if (obstacle.kind === "falling" && world.attackMs > 0 && !obstacle.spent) {
      obstacle.spent = true;
      bumpCombo(world);
      award(world, SCORE_ENEMY);
      world.events.push({
        kind: "enemy",
        x: obstacle.x,
        y: top + obstacle.height,
      });
      continue;
    }
    if (obstacle.spent) continue;
    if (world.invulnerableMs > 0 || world.fever) continue;
    rewind(world, HAZARD_REWIND);
    world.events.push({ kind: "hit", reason: "hazard" });
  }

  /* checkpoints and zone changes */
  for (const checkpoint of world.level.checkpoints) {
    if (checkpoint.reached || world.camera < checkpoint.x) continue;
    checkpoint.reached = true;
    world.lastCheckpoint = checkpoint.x;
    if (checkpoint.index > 0) {
      award(world, SCORE_ZONE_CLEAR);
      world.events.push({ kind: "checkpoint", index: checkpoint.index });
    }
  }
  const zone = zoneAt(world.camera);
  if (zone !== world.zone) {
    world.zone = zone;
    world.events.push({ kind: "zone", zone });
  }
  if (!world.finaleCleared && world.camera > FINALE_OBSTACLE_X + 60) {
    world.finaleCleared = true;
    world.score += SCORE_FINALE;
    world.events.push({ kind: "finale-cleared" });
  }

  if (world.time >= RUN_SECONDS || world.camera >= TOTAL_DISTANCE) {
    world.camera = Math.min(world.camera, TOTAL_DISTANCE);
    world.finished = true;
    world.events.push({ kind: "finished" });
  }

  return world;
};

/* ── Result ─────────────────────────────────────────────────────────────── */

export type Grade = "S" | "A" | "B" | "C";

export const GRADE_CUTS: { grade: Grade; score: number }[] = [
  { grade: "S", score: 46000 },
  { grade: "A", score: 32000 },
  { grade: "B", score: 16000 },
  { grade: "C", score: 0 },
];

export const gradeFor = (score: number, progress: number): Grade => {
  // A run that never reached the stage cannot outrank a completed one.
  const adjusted = progress >= 0.995 ? score : score * 0.85;
  return (GRADE_CUTS.find((cut) => adjusted >= cut.score) ?? GRADE_CUTS[3])
    .grade;
};

export type RunSummary = {
  character: CharacterId;
  characterName: string;
  score: number;
  grade: Grade;
  maxCombo: number;
  items: number;
  enemiesCleared: number;
  feverCount: number;
  hits: number;
  progress: number;
  seconds: number;
  complete: boolean;
  style: string;
};

/** Result copy T2 — one line derived from how the run actually went. */
export const styleFor = (world: World): string => {
  if (world.hits === 0) return "한 번도 놓치지 않은 CLEAN SET";
  if (world.feverCount >= 4) return "무대를 태우는 FEVER MACHINE";
  if (world.maxCombo >= 14) return "리듬을 놓치지 않는 STREET FLOW";
  if (world.items >= 120 && world.hits <= 20)
    return "빠짐없이 주워 담는 CRATE DIGGER";
  return "끝까지 달린 ROOKIE RUNNER";
};

export const summarize = (world: World): RunSummary => {
  const progress = Math.min(1, world.camera / TOTAL_DISTANCE);
  return {
    character: world.character.id,
    characterName: world.character.name,
    score: world.score,
    grade: gradeFor(world.score, progress),
    maxCombo: world.maxCombo,
    items: world.items,
    enemiesCleared: world.enemiesCleared,
    feverCount: world.feverCount,
    hits: world.hits,
    progress,
    seconds: Math.round(world.time),
    complete: progress >= 0.995,
    style: styleFor(world),
  };
};

export const formatScore = (score: number) =>
  String(Math.max(0, Math.round(score))).padStart(6, "0");

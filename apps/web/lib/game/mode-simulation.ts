/**
 * Pure gameplay simulation for the three mode sets — DANCE, SOCCER, DRIVE.
 *
 * Same contract as `./simulation` (the existing adventure runner):
 *  - NO imports, so `scripts/smoke-game.mjs` can import this file directly and
 *    assert the *shipped* rules headlessly (Node strips the types).
 *  - No DOM/Node APIs and no non-erasable TypeScript syntax (no enums, no
 *    parameter properties).
 *  - Deterministic: every world carries its own seeded RNG, so a given input
 *    sequence always produces the same match.
 *
 * The adventure runner in `./simulation` is untouched; these modes only add.
 */

/* ── shared shell contract ──────────────────────────────────────────────── */

/** Same logical canvas as the runner — the shell scales it by an integer factor. */
export const LOGICAL_WIDTH = 320;
export const LOGICAL_HEIGHT = 180;

export const MODE_IDS = ["dance", "soccer", "drive"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const isModeId = (value: string): value is ModeId =>
  (MODE_IDS as readonly string[]).includes(value);

/**
 * One input shape for all three modes.
 *  - `left` / `right` are *held* (soccer move, drive brake/accelerate)
 *  - `leftPressed` / `rightPressed` are edges (dance lane taps)
 *  - `aPressed` / `bPressed` are the two shell buttons, remapped per mode
 */
export type ModeInput = {
  left: boolean;
  right: boolean;
  leftPressed: boolean;
  rightPressed: boolean;
  aPressed: boolean;
  bPressed: boolean;
};

export const emptyModeInput = (): ModeInput => ({
  left: false,
  right: false,
  leftPressed: false,
  rightPressed: false,
  aPressed: false,
  bPressed: false,
});

export type Grade = "S" | "A" | "B" | "C";

export type ModeStat = { label: string; value: string };

/** Everything the shared result pass needs, so the UI stays mode-agnostic. */
export type ModeSummary = {
  mode: ModeId;
  grade: Grade;
  score: number;
  /** `true` renders the success stamp note; `false` renders the partial one. */
  complete: boolean;
  stampLabel: string;
  stampValue: string;
  stampNote: string;
  /** `"lead|emphasis"` — the result headline is split on the pipe. */
  headline: string;
  stats: ModeStat[];
  seconds: number;
};

/** Transient state the HUD and the live region read every frame. */
export type ModeEvent =
  | { kind: "judge"; judgement: DanceJudgement }
  | { kind: "goal"; scorer: "you" | "cpu" }
  | { kind: "save" }
  | { kind: "kick" }
  | { kind: "jump"; double: boolean }
  | { kind: "smash" }
  | { kind: "heart" }
  | { kind: "damage"; hp: number }
  | { kind: "finished" };

const gradeFrom = (cuts: [Grade, number][], value: number): Grade => {
  for (const [grade, cut] of cuts) if (value >= cut) return grade;
  return "C";
};

/** xorshift32 — small, dependency free and identical in Node and the browser. */
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

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};

export const formatScore = (score: number) =>
  String(Math.max(0, Math.round(score))).padStart(6, "0");

/* ══ DANCE ════════════════════════════════════════════════════════════════
 * 96 BPM · PERFECT ±83ms (±5 frames) · GOOD ±200ms (±12 frames) · 01:35.
 * Four lanes mapped to the two stage pads and the two shell buttons.
 */

export const DANCE_SECONDS = 95;
export const DANCE_BPM = 96;
export const DANCE_BEAT = 60 / DANCE_BPM;
export const DANCE_PERFECT_MS = 83;
export const DANCE_GOOD_MS = 200;
/** How long a note is on screen before it reaches the receptor. */
export const DANCE_LEAD = 1.8;
export const DANCE_CROWD_START = 60;

/** Lane order is the on-screen receptor order, left to right. */
export const DANCE_LANES = ["left", "down", "up", "right"] as const;
export type DanceLane = (typeof DANCE_LANES)[number];
export type DanceJudgement = "perfect" | "good" | "miss";

export type DanceNote = {
  lane: number;
  time: number;
  judged: DanceJudgement | null;
};

/**
 * Deterministic chart: one note per beat from the fifth beat, plus an extra
 * off-beat every fourth bar so the pattern is not metronomic.
 */
export const buildDanceChart = (): DanceNote[] => {
  const random = createRandom(0xda_5c_e0_11);
  const notes: DanceNote[] = [];
  const firstBeat = 5;
  const lastBeat = Math.floor((DANCE_SECONDS - 4) / DANCE_BEAT);
  let lane = 0;
  for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
    // step to a neighbouring lane most of the time so the chart stays danceable
    const roll = random();
    lane =
      roll < 0.42
        ? (lane + 1) % 4
        : roll < 0.78
          ? (lane + 3) % 4
          : Math.floor(random() * 4) % 4;
    notes.push({ lane, time: beat * DANCE_BEAT, judged: null });
    if (beat % 8 === 3 && beat > firstBeat + 8) {
      notes.push({
        lane: (lane + 2) % 4,
        time: (beat + 0.5) * DANCE_BEAT,
        judged: null,
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return notes;
};

export type DanceWorld = {
  mode: "dance";
  notes: DanceNote[];
  time: number;
  score: number;
  combo: number;
  bestCombo: number;
  perfect: number;
  good: number;
  miss: number;
  crowd: number;
  judgement: DanceJudgement | null;
  judgementMs: number;
  /** Receptor flash per lane, in ms. */
  laneFlash: number[];
  finished: boolean;
  events: ModeEvent[];
};

export const createDanceWorld = (): DanceWorld => ({
  mode: "dance",
  notes: buildDanceChart(),
  time: 0,
  score: 0,
  combo: 0,
  bestCombo: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  crowd: DANCE_CROWD_START,
  judgement: null,
  judgementMs: 0,
  laneFlash: [0, 0, 0, 0],
  finished: false,
  events: [],
});

export const danceMultiplier = (combo: number) =>
  clamp(1 + Math.floor(combo / 10), 1, 4);

const danceJudge = (world: DanceWorld, lane: number) => {
  world.laneFlash[lane] = 140;
  let target: DanceNote | null = null;
  let bestDelta = Infinity;
  for (const note of world.notes) {
    if (note.judged || note.lane !== lane) continue;
    const delta = Math.abs(note.time - world.time);
    if (note.time - world.time > DANCE_GOOD_MS / 1000) break;
    if (delta < bestDelta) {
      bestDelta = delta;
      target = note;
    }
  }
  if (!target || bestDelta > DANCE_GOOD_MS / 1000) return;

  const judgement: DanceJudgement =
    bestDelta <= DANCE_PERFECT_MS / 1000 ? "perfect" : "good";
  target.judged = judgement;
  world.judgement = judgement;
  world.judgementMs = 420;
  world.combo += 1;
  world.bestCombo = Math.max(world.bestCombo, world.combo);
  if (judgement === "perfect") {
    world.perfect += 1;
    world.crowd = clamp(world.crowd + 2, 0, 100);
    world.score += 300 * danceMultiplier(world.combo);
  } else {
    world.good += 1;
    world.crowd = clamp(world.crowd + 1, 0, 100);
    world.score += 150 * danceMultiplier(world.combo);
  }
  world.events.push({ kind: "judge", judgement });
};

export const stepDance = (world: DanceWorld, dt: number, input: ModeInput) => {
  if (world.finished) return world;
  const stepDt = Math.min(dt, 1 / 30);
  const ms = stepDt * 1000;
  world.time += stepDt;
  world.judgementMs = Math.max(0, world.judgementMs - ms);
  if (world.judgementMs === 0) world.judgement = null;
  for (let lane = 0; lane < 4; lane += 1) {
    world.laneFlash[lane] = Math.max(0, world.laneFlash[lane] - ms);
  }

  // pad-left = left lane, B = down, A = up, pad-right = right lane
  if (input.leftPressed) danceJudge(world, 0);
  if (input.bPressed) danceJudge(world, 1);
  if (input.aPressed) danceJudge(world, 2);
  if (input.rightPressed) danceJudge(world, 3);

  for (const note of world.notes) {
    if (note.judged) continue;
    if (note.time > world.time - DANCE_GOOD_MS / 1000) break;
    note.judged = "miss";
    world.miss += 1;
    world.combo = 0;
    // A dropped crowd never ends the set (K14: the run always finishes).
    world.crowd = clamp(world.crowd - 4, 0, 100);
    world.judgement = "miss";
    world.judgementMs = 420;
    world.events.push({ kind: "judge", judgement: "miss" });
  }

  if (world.time >= DANCE_SECONDS) {
    world.time = DANCE_SECONDS;
    world.finished = true;
    world.events.push({ kind: "finished" });
  }
  return world;
};

export const danceAccuracy = (world: DanceWorld) => {
  const judged = world.perfect + world.good + world.miss;
  return judged === 0 ? 0 : (world.perfect + world.good * 0.6) / judged;
};

export const summarizeDance = (world: DanceWorld): ModeSummary => {
  const accuracy = danceAccuracy(world);
  const grade = gradeFrom(
    [
      ["S", 0.92],
      ["A", 0.78],
      ["B", 0.55],
    ],
    accuracy,
  );
  const complete = world.crowd >= 40;
  return {
    mode: "dance",
    grade,
    score: world.score,
    complete,
    stampLabel: "SYNC",
    stampValue: grade,
    stampNote: complete ? "SHOW COMPLETE" : "SHOW PARTIAL",
    headline:
      world.miss === 0
        ? "한 박자도 흘리지 않은|PERFECT TAKE"
        : world.bestCombo >= 30
          ? "비트를 놓치지 않은|HEADLINER"
          : world.crowd >= 40
            ? "무대를 데운|FLOOR STARTER"
            : "끝까지 버틴|ROOKIE DANCER",
    stats: [
      { label: "PERFECT", value: String(world.perfect).padStart(2, "0") },
      { label: "GOOD", value: String(world.good).padStart(2, "0") },
      { label: "MISS", value: String(world.miss).padStart(2, "0") },
      { label: "BEST COMBO", value: String(world.bestCombo).padStart(2, "0") },
    ],
    seconds: Math.round(world.time),
  };
};

/* ══ SOCCER ═══════════════════════════════════════════════════════════════
 * First to 5 or 100 seconds. You attack the right goal; the CPU attacks the
 * left one. A = jump, B = kick, stage pads = move.
 */

export const SOCCER_SECONDS = 100;
export const SOCCER_TARGET = 5;
export const SOCCER_GROUND = 168;
/** Lowest y the ball may reach; keeps it clear of the HUD band overlay. */
export const SOCCER_CEILING = 56;
export const SOCCER_GOAL_HEIGHT = 34;
export const SOCCER_GOAL_DEPTH = 18;
export const SOCCER_MIN_X = 24;
export const SOCCER_MAX_X = 296;
export const SOCCER_PLAYER_SPEED = 78;
export const SOCCER_CPU_SPEED = 52;
export const SOCCER_JUMP = 200;
export const SOCCER_GRAVITY = 620;
export const SOCCER_KICK_RANGE = 24;
export const SOCCER_KICK_COOLDOWN = 0.28;

export type SoccerActor = { x: number; y: number; vy: number; onGround: boolean };
export type SoccerBall = { x: number; y: number; vx: number; vy: number };

export type SoccerWorld = {
  mode: "soccer";
  time: number;
  you: number;
  cpu: number;
  shots: number;
  saves: number;
  player: SoccerActor;
  opponent: SoccerActor;
  ball: SoccerBall;
  kickCooldown: number;
  cpuCooldown: number;
  /** One deflection may only score one SAVE, however long the ball rests on you. */
  saveCooldown: number;
  /** Freeze frame after a goal so the shell can flash the score. */
  resetMs: number;
  goalFlashMs: number;
  lastScorer: "you" | "cpu" | null;
  random: () => number;
  finished: boolean;
  events: ModeEvent[];
};

const soccerKickoff = (world: SoccerWorld, toward: number) => {
  world.player = { x: 108, y: SOCCER_GROUND, vy: 0, onGround: true };
  world.opponent = { x: 212, y: SOCCER_GROUND, vy: 0, onGround: true };
  world.ball = {
    x: LOGICAL_WIDTH / 2,
    y: SOCCER_GROUND - 40,
    vx: toward * 30,
    vy: 0,
  };
};

export const createSoccerWorld = (seed = 0x50_cc_e1_25): SoccerWorld => {
  const world: SoccerWorld = {
    mode: "soccer",
    time: 0,
    you: 0,
    cpu: 0,
    shots: 0,
    saves: 0,
    player: { x: 108, y: SOCCER_GROUND, vy: 0, onGround: true },
    opponent: { x: 212, y: SOCCER_GROUND, vy: 0, onGround: true },
    ball: { x: LOGICAL_WIDTH / 2, y: SOCCER_GROUND - 40, vx: 0, vy: 0 },
    kickCooldown: 0,
    cpuCooldown: 0,
    saveCooldown: 0,
    resetMs: 0,
    goalFlashMs: 0,
    lastScorer: null,
    random: createRandom(seed),
    finished: false,
    events: [],
  };
  soccerKickoff(world, 1);
  return world;
};

const soccerStepActor = (
  actor: SoccerActor,
  dt: number,
  direction: number,
  speed: number,
  jump: boolean,
) => {
  actor.x = clamp(actor.x + direction * speed * dt, SOCCER_MIN_X, SOCCER_MAX_X);
  if (jump && actor.onGround) {
    actor.vy = -SOCCER_JUMP;
    actor.onGround = false;
  }
  actor.vy += SOCCER_GRAVITY * dt;
  actor.y += actor.vy * dt;
  if (actor.y >= SOCCER_GROUND) {
    actor.y = SOCCER_GROUND;
    actor.vy = 0;
    actor.onGround = true;
  }
};

const soccerBodyHit = (actor: SoccerActor, ball: SoccerBall) =>
  Math.abs(actor.x - ball.x) < 16 && ball.y > actor.y - 34 && ball.y < actor.y + 6;

export const stepSoccer = (world: SoccerWorld, dt: number, input: ModeInput) => {
  if (world.finished) return world;
  const stepDt = Math.min(dt, 1 / 30);
  const ms = stepDt * 1000;
  world.time += stepDt;
  world.kickCooldown = Math.max(0, world.kickCooldown - stepDt);
  world.cpuCooldown = Math.max(0, world.cpuCooldown - stepDt);
  world.saveCooldown = Math.max(0, world.saveCooldown - stepDt);
  world.goalFlashMs = Math.max(0, world.goalFlashMs - ms);

  if (world.resetMs > 0) {
    world.resetMs = Math.max(0, world.resetMs - ms);
    if (world.resetMs === 0) {
      soccerKickoff(world, world.lastScorer === "you" ? -1 : 1);
    }
  } else {
    const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    soccerStepActor(
      world.player,
      stepDt,
      direction,
      SOCCER_PLAYER_SPEED,
      input.aPressed,
    );
    if (input.aPressed && world.player.onGround === false) {
      world.events.push({ kind: "jump", double: false });
    }

    // CPU: close on the ball, then clear it toward your goal.
    const chase = world.ball.x < world.opponent.x ? -1 : 1;
    const idle = Math.abs(world.ball.x - world.opponent.x) < 6;
    soccerStepActor(
      world.opponent,
      stepDt,
      idle ? 0 : chase,
      SOCCER_CPU_SPEED,
      world.ball.y < SOCCER_GROUND - 34 &&
        Math.abs(world.ball.x - world.opponent.x) < 28,
    );

    const ball = world.ball;
    ball.vy += SOCCER_GRAVITY * 0.62 * stepDt;
    ball.x += ball.vx * stepDt;
    ball.y += ball.vy * stepDt;
    ball.vx *= 1 - 0.5 * stepDt;

    if (ball.y >= SOCCER_GROUND - 6) {
      ball.y = SOCCER_GROUND - 6;
      ball.vy = -ball.vy * 0.58;
      ball.vx *= 0.9;
      if (Math.abs(ball.vy) < 24) ball.vy = 0;
    }
    // the HUD band overlays the top of the frame at 1× and 2×, so the ball is
    // never allowed to disappear behind it
    if (ball.y < SOCCER_CEILING) {
      ball.y = SOCCER_CEILING;
      ball.vy = Math.abs(ball.vy) * 0.5;
    }

    // player kick
    if (
      input.bPressed &&
      world.kickCooldown === 0 &&
      Math.abs(ball.x - world.player.x) < SOCCER_KICK_RANGE &&
      ball.y > world.player.y - 40
    ) {
      world.kickCooldown = SOCCER_KICK_COOLDOWN;
      ball.vx = 148 + world.random() * 24;
      ball.vy = -122 - world.random() * 28;
      world.shots += 1;
      world.events.push({ kind: "kick" });
    }

    // bodies deflect the ball; blocking a CPU shot counts as a save
    if (soccerBodyHit(world.player, ball) && ball.vx < 0) {
      ball.vx = Math.abs(ball.vx) * 0.7 + 40;
      if (world.saveCooldown === 0) {
        world.saveCooldown = 0.5;
        world.saves += 1;
        world.events.push({ kind: "save" });
      }
    } else if (soccerBodyHit(world.player, ball)) {
      ball.vx += 30 * stepDt * 60 * 0.05;
    }

    // the opponent body is a wall too, so a shot has to beat the keeper
    if (soccerBodyHit(world.opponent, ball) && ball.vx > 0) {
      ball.vx = -Math.abs(ball.vx) * 0.66 - 24;
      ball.vy = Math.min(ball.vy, -40);
    }

    if (
      world.cpuCooldown === 0 &&
      Math.abs(ball.x - world.opponent.x) < SOCCER_KICK_RANGE &&
      ball.y > world.opponent.y - 40
    ) {
      world.cpuCooldown = 0.78;
      ball.vx = -(118 + world.random() * 34);
      ball.vy = -(92 + world.random() * 44);
    }

    // goals sit inside the touchlines, mouth height only
    const inMouth = ball.y > SOCCER_GROUND - SOCCER_GOAL_HEIGHT;
    if (ball.x <= SOCCER_GOAL_DEPTH && inMouth) {
      world.cpu += 1;
      world.lastScorer = "cpu";
      world.resetMs = 900;
      world.goalFlashMs = 900;
      world.events.push({ kind: "goal", scorer: "cpu" });
    } else if (ball.x >= LOGICAL_WIDTH - SOCCER_GOAL_DEPTH && inMouth) {
      world.you += 1;
      world.lastScorer = "you";
      world.resetMs = 900;
      world.goalFlashMs = 900;
      world.events.push({ kind: "goal", scorer: "you" });
    } else if (ball.x < 8) {
      ball.x = 8;
      ball.vx = Math.abs(ball.vx) * 0.6;
    } else if (ball.x > LOGICAL_WIDTH - 8) {
      ball.x = LOGICAL_WIDTH - 8;
      ball.vx = -Math.abs(ball.vx) * 0.6;
    }
  }

  if (
    world.time >= SOCCER_SECONDS ||
    world.you >= SOCCER_TARGET ||
    world.cpu >= SOCCER_TARGET
  ) {
    world.finished = true;
    world.events.push({ kind: "finished" });
  }
  return world;
};

export const summarizeSoccer = (world: SoccerWorld): ModeSummary => {
  const win = world.you > world.cpu;
  const draw = world.you === world.cpu;
  const score = world.you * 3000 + world.shots * 120 + world.saves * 180;
  const grade = gradeFrom(
    [
      ["S", 5],
      ["A", 3],
      ["B", 1],
    ],
    world.you - world.cpu + (win ? 2 : 0),
  );
  return {
    mode: "soccer",
    grade,
    score,
    complete: win,
    stampLabel: win ? "WIN" : draw ? "DRAW" : "LOSE",
    stampValue: `${world.you}—${world.cpu}`,
    stampNote: win
      ? "MATCH COMPLETE"
      : draw
        ? "MATCH DRAWN"
        : "MATCH COMPLETE",
    headline: win
      ? world.cpu === 0
        ? "한 골도 내주지 않은|CLEAN SHEET"
        : "끝까지 골문을 연|PLAYMAKER"
      : draw
        ? "마지막까지 팽팽한|EQUALISER"
        : "다음 킥오프를 노리는|CHALLENGER",
    stats: [
      { label: "YOU", value: String(world.you) },
      { label: "CPU", value: String(world.cpu) },
      { label: "SHOTS", value: String(world.shots).padStart(2, "0") },
      { label: "SAVES", value: String(world.saves).padStart(2, "0") },
    ],
    seconds: Math.round(world.time),
  };
};

/* ══ DRIVE ════════════════════════════════════════════════════════════════
 * 4,000M · HP 3 · BOOST 100. Right accelerates, left brakes, A double-jumps
 * over a block, B spends boost to shoot one down.
 */

export const DRIVE_DISTANCE = 4000;
export const DRIVE_MAX_HP = 3;
export const DRIVE_BOOST_MAX = 100;
export const DRIVE_SHOT_COST = 14;
export const DRIVE_SPEED_MIN = 3;
export const DRIVE_SPEED_CRUISE = 8;
export const DRIVE_SPEED_MAX = 11;
export const DRIVE_SPEED_BOOST_MAX = 14;
/** Display speed × this = metres per second. */
export const DRIVE_METERS_PER_SPEED = 5;
export const DRIVE_JUMP_MS = 760;
export const DRIVE_INVULNERABLE_MS = 1500;
/** How far ahead of the car an obstacle is still shootable. */
export const DRIVE_SHOT_REACH = 260;

export type DriveHazardKind = "block" | "heart";
export type DriveHazard = {
  kind: DriveHazardKind;
  distance: number;
  /** -1 .. 1 across the road; drawn with perspective, not steered. */
  offset: number;
  spent: boolean;
};

export const buildDriveRoute = (): DriveHazard[] => {
  const random = createRandom(0x0d_21_be_07);
  const hazards: DriveHazard[] = [];
  for (let distance = 260; distance < DRIVE_DISTANCE - 120; distance += 92) {
    const roll = random();
    hazards.push({
      kind: roll < 0.26 ? "heart" : "block",
      distance: distance + Math.round(random() * 40),
      offset: (random() - 0.5) * 1.4,
      spent: false,
    });
  }
  return hazards;
};

export type DriveWorld = {
  mode: "drive";
  time: number;
  distance: number;
  speed: number;
  hp: number;
  boost: number;
  hearts: number;
  smash: number;
  score: number;
  hazards: DriveHazard[];
  jumpMs: number;
  jumpsUsed: number;
  invulnerableMs: number;
  shotMs: number;
  statusMs: number;
  status: string;
  finished: boolean;
  wrecked: boolean;
  events: ModeEvent[];
};

export const createDriveWorld = (): DriveWorld => ({
  mode: "drive",
  time: 0,
  distance: 0,
  speed: DRIVE_SPEED_CRUISE,
  hp: DRIVE_MAX_HP,
  boost: 40,
  hearts: 0,
  smash: 0,
  score: 0,
  hazards: buildDriveRoute(),
  jumpMs: 0,
  jumpsUsed: 0,
  invulnerableMs: 0,
  shotMs: 0,
  statusMs: 0,
  status: "",
  finished: false,
  wrecked: false,
  events: [],
});

const driveSay = (world: DriveWorld, status: string) => {
  world.status = status;
  world.statusMs = 700;
};

export const stepDrive = (world: DriveWorld, dt: number, input: ModeInput) => {
  if (world.finished) return world;
  const stepDt = Math.min(dt, 1 / 30);
  const ms = stepDt * 1000;
  world.time += stepDt;
  world.jumpMs = Math.max(0, world.jumpMs - ms);
  if (world.jumpMs === 0) world.jumpsUsed = 0;
  world.invulnerableMs = Math.max(0, world.invulnerableMs - ms);
  world.shotMs = Math.max(0, world.shotMs - ms);
  world.statusMs = Math.max(0, world.statusMs - ms);
  if (world.statusMs === 0) world.status = "";

  const ceiling = world.boost >= 99 ? DRIVE_SPEED_BOOST_MAX : DRIVE_SPEED_MAX;
  if (input.right) world.speed += 6 * stepDt;
  else if (input.left) world.speed -= 11 * stepDt;
  else world.speed += (DRIVE_SPEED_CRUISE - world.speed) * stepDt * 1.4;
  world.speed = clamp(world.speed, DRIVE_SPEED_MIN, ceiling);

  world.distance = Math.min(
    DRIVE_DISTANCE,
    world.distance + world.speed * DRIVE_METERS_PER_SPEED * stepDt,
  );

  if (input.aPressed && world.jumpsUsed < 2) {
    world.jumpsUsed += 1;
    world.jumpMs = DRIVE_JUMP_MS;
    world.events.push({ kind: "jump", double: world.jumpsUsed === 2 });
    driveSay(world, world.jumpsUsed === 2 ? "DOUBLE JUMP" : "JUMP");
  }

  if (input.bPressed && world.boost >= DRIVE_SHOT_COST && world.shotMs === 0) {
    world.boost -= DRIVE_SHOT_COST;
    world.shotMs = 220;
    const target = world.hazards.find(
      (hazard) =>
        !hazard.spent &&
        hazard.kind === "block" &&
        hazard.distance > world.distance &&
        hazard.distance < world.distance + DRIVE_SHOT_REACH,
    );
    if (target) {
      target.spent = true;
      world.smash += 1;
      world.score += 120;
      world.events.push({ kind: "smash" });
      driveSay(world, "SMASH!");
    }
  }

  const airborne = world.jumpMs > 0;
  for (const hazard of world.hazards) {
    if (hazard.spent) continue;
    if (hazard.distance > world.distance + 30) break;
    if (hazard.distance > world.distance - 6) continue;
    hazard.spent = true;
    if (hazard.kind === "heart") {
      if (airborne) continue; // a jump flies over the pickup too
      world.hearts += 1;
      world.boost = clamp(world.boost + 18, 0, DRIVE_BOOST_MAX);
      world.score += 60;
      world.events.push({ kind: "heart" });
      driveSay(world, "BOOST +18");
      continue;
    }
    if (airborne || world.invulnerableMs > 0) continue;
    world.hp -= 1;
    world.speed = DRIVE_SPEED_MIN;
    world.invulnerableMs = DRIVE_INVULNERABLE_MS;
    world.events.push({ kind: "damage", hp: world.hp });
    driveSay(world, world.hp > 0 ? `HP ${world.hp}/3` : "WRECKED");
  }

  world.score = Math.round(
    world.distance + world.smash * 120 + world.hearts * 60,
  );

  if (world.hp <= 0) {
    world.hp = 0;
    world.wrecked = true;
    world.finished = true;
    world.events.push({ kind: "finished" });
  } else if (world.distance >= DRIVE_DISTANCE) {
    world.score += world.hp * 500;
    world.finished = true;
    world.events.push({ kind: "finished" });
  }
  return world;
};

export const formatMeters = (value: number) =>
  Math.round(value).toLocaleString("en-US");

export const summarizeDrive = (world: DriveWorld): ModeSummary => {
  const home = !world.wrecked && world.distance >= DRIVE_DISTANCE;
  const grade = gradeFrom(
    [
      ["S", 5200],
      ["A", 4200],
      ["B", 2200],
    ],
    world.score,
  );
  return {
    mode: "drive",
    grade,
    score: world.score,
    complete: home,
    stampLabel: home ? "HOME" : "WRECKED",
    stampValue: home ? "4K" : `${Math.round((world.distance / DRIVE_DISTANCE) * 100)}%`,
    stampNote: home ? "MADE IT" : "RUN ENDED",
    headline: home
      ? world.hp === DRIVE_MAX_HP
        ? "긁힘 하나 없이 도착한|NIGHT CRUISER"
        : "석양보다 먼저 닿은|ROAD HERO"
      : "석양에 멈춰 선|SUNSET DRIFTER",
    stats: [
      { label: "DISTANCE", value: `${formatMeters(world.distance)}M` },
      { label: "SCORE", value: formatScore(world.score) },
      { label: "HEARTS", value: String(world.hearts).padStart(2, "0") },
      { label: "SMASH", value: String(world.smash).padStart(2, "0") },
    ],
    seconds: Math.round(world.time),
  };
};

/* ══ mode-agnostic facade ═════════════════════════════════════════════════ */

export type ModeWorld = DanceWorld | SoccerWorld | DriveWorld;

export const createModeWorld = (mode: ModeId): ModeWorld =>
  mode === "dance"
    ? createDanceWorld()
    : mode === "soccer"
      ? createSoccerWorld()
      : createDriveWorld();

export const stepModeWorld = (
  world: ModeWorld,
  dt: number,
  input: ModeInput,
): ModeWorld =>
  world.mode === "dance"
    ? stepDance(world, dt, input)
    : world.mode === "soccer"
      ? stepSoccer(world, dt, input)
      : stepDrive(world, dt, input);

export const summarizeMode = (world: ModeWorld): ModeSummary =>
  world.mode === "dance"
    ? summarizeDance(world)
    : world.mode === "soccer"
      ? summarizeSoccer(world)
      : summarizeDrive(world);

/* ── HUD projection ─────────────────────────────────────────────────────── */

export type ModeHud =
  | {
      mode: "dance";
      score: number;
      combo: number;
      multiplier: number;
      crowd: number;
      judgement: DanceJudgement | null;
      elapsed: number;
      total: number;
    }
  | {
      mode: "soccer";
      score: number;
      you: number;
      cpu: number;
      remaining: number;
      shots: number;
      saves: number;
      goalFlash: boolean;
    }
  | {
      mode: "drive";
      score: number;
      distance: number;
      hp: number;
      boost: number;
      speed: number;
      smash: number;
      status: string;
    };

export const hudOfMode = (world: ModeWorld): ModeHud => {
  if (world.mode === "dance") {
    return {
      mode: "dance",
      score: world.score,
      combo: world.combo,
      multiplier: danceMultiplier(world.combo),
      crowd: Math.round(world.crowd),
      judgement: world.judgement,
      elapsed: world.time,
      total: DANCE_SECONDS,
    };
  }
  if (world.mode === "soccer") {
    return {
      mode: "soccer",
      score: world.you * 3000 + world.shots * 120 + world.saves * 180,
      you: world.you,
      cpu: world.cpu,
      remaining: Math.max(0, SOCCER_SECONDS - world.time),
      shots: world.shots,
      saves: world.saves,
      goalFlash: world.goalFlashMs > 0,
    };
  }
  return {
    mode: "drive",
    score: world.score,
    distance: world.distance,
    hp: world.hp,
    boost: Math.round(world.boost),
    speed: world.speed,
    smash: world.smash,
    status: world.status,
  };
};

export const emptyModeHud = (mode: ModeId): ModeHud =>
  hudOfMode(createModeWorld(mode));

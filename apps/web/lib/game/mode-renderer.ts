import type { LoadedAtlas } from "./atlas";
import type { CharacterId } from "./simulation";
import {
  DANCE_LEAD,
  DRIVE_DISTANCE,
  DRIVE_MAX_HP,
  type DanceWorld,
  type DriveWorld,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type ModeWorld,
  SOCCER_GOAL_HEIGHT,
  SOCCER_GROUND,
  type SoccerWorld,
} from "./mode-simulation";

/** Same token palette the runner renderer uses (`app/styles.css` :root). */
const COLORS = {
  ink: "#20143a",
  inkDeep: "#0a0412",
  inkFar: "#161b34",
  cream: "#fae08c",
  white: "#fffcf6",
  pink: "#f55e8c",
  pinkHot: "#f5187c",
  gold: "#f7be3c",
  orange: "#f5871f",
  teal: "#2ab6a8",
  purple: "#7b3fa8",
  purpleDeep: "#4a2274",
  green: "#22c878",
  greenDeep: "#148c54",
  danger: "#ff4b4b",
} as const;

export type ModeRenderOptions = {
  reducedMotion: boolean;
  character: CharacterId;
};

const frameRect = (atlas: LoadedAtlas, name: string) =>
  atlas.data.frames[name]?.frame;

const draw = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  flip = false,
) => {
  const rect = frameRect(atlas, name);
  if (!rect) return;
  const dx = Math.round(x);
  const dy = Math.round(y);
  if (flip) {
    context.save();
    context.translate(dx + width, dy);
    context.scale(-1, 1);
    context.drawImage(atlas.image, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
    context.restore();
    return;
  }
  context.drawImage(atlas.image, rect.x, rect.y, rect.w, rect.h, dx, dy, width, height);
};

/* ══ DANCE ════════════════════════════════════════════════════════════════ */

/** Lane rows, top to bottom, matching `DANCE_LANES`. */
export const DANCE_ROW_Y = [30, 52, 74, 96];
export const DANCE_RECEPTOR_X = 20;
const DANCE_LANE_FRAME = ["arrow_left", "arrow_down", "arrow_up", "arrow_right"];
const DANCE_TRAVEL = LOGICAL_WIDTH - DANCE_RECEPTOR_X - 16;
/** Top of the stage floor the dancer stands on. */
const DANCE_FLOOR_Y = 122;

const drawDance = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: DanceWorld,
  options: ModeRenderOptions,
) => {
  context.fillStyle = COLORS.inkFar;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // backdrop: the existing stage tiles keep the venue continuous with the runner
  for (let column = -1; column < 6; column += 1) {
    draw(context, atlas, "tile_stage_04", column * 64, 4, 64, 64);
  }
  context.fillStyle = "rgba(10, 4, 18, .74)";
  context.fillRect(0, 0, LOGICAL_WIDTH, DANCE_FLOOR_Y);

  // stage floor
  context.fillStyle = COLORS.purpleDeep;
  context.fillRect(0, DANCE_FLOOR_Y, LOGICAL_WIDTH, LOGICAL_HEIGHT - DANCE_FLOOR_Y);
  context.fillStyle = "rgba(122, 63, 168, .5)";
  for (let x = 0; x < LOGICAL_WIDTH; x += 32) {
    context.fillRect(x, DANCE_FLOOR_Y, 16, LOGICAL_HEIGHT - DANCE_FLOOR_Y);
  }

  // lane corridor
  for (let lane = 0; lane < 4; lane += 1) {
    const y = DANCE_ROW_Y[lane];
    context.fillStyle = "rgba(32, 20, 58, .78)";
    context.fillRect(0, y - 2, LOGICAL_WIDTH, 20);
    context.fillStyle = "rgba(122, 63, 168, .42)";
    context.fillRect(DANCE_RECEPTOR_X + 10, y + 7, LOGICAL_WIDTH, 1);
  }

  // notes travel right → left; only the visible window is drawn
  for (const note of world.notes) {
    if (note.judged && note.judged !== "miss") continue;
    const ahead = note.time - world.time;
    if (ahead > DANCE_LEAD) break;
    if (ahead < -0.35) continue;
    const x = DANCE_RECEPTOR_X + (ahead / DANCE_LEAD) * DANCE_TRAVEL;
    context.globalAlpha = note.judged === "miss" ? 0.35 : 1;
    draw(context, atlas, DANCE_LANE_FRAME[note.lane], x - 8, DANCE_ROW_Y[note.lane], 16, 16);
    context.globalAlpha = 1;
  }

  // receptors + hit ring
  for (let lane = 0; lane < 4; lane += 1) {
    const y = DANCE_ROW_Y[lane];
    context.globalAlpha = 0.55;
    draw(context, atlas, DANCE_LANE_FRAME[lane], DANCE_RECEPTOR_X - 8, y, 16, 16);
    context.globalAlpha = 1;
    context.strokeStyle = world.laneFlash[lane] > 0 ? COLORS.cream : COLORS.pinkHot;
    context.lineWidth = 1;
    context.strokeRect(DANCE_RECEPTOR_X - 10.5, y - 2.5, 21, 21);
    if (world.laneFlash[lane] > 0) {
      draw(context, atlas, "judgement_ring", DANCE_RECEPTOR_X - 12, y - 4, 24, 24);
    }
  }

  // the dancer keeps the existing character sprites
  const beat = world.time / (60 / 96);
  const bounce = options.reducedMotion ? 0 : Math.abs(Math.sin(beat * Math.PI)) * 4;
  const pose = world.judgement === "miss" ? "idle" : "run";
  const step = Math.floor(beat * 2) % 4;
  draw(
    context,
    atlas,
    `${options.character}_${pose}_${step}`,
    LOGICAL_WIDTH / 2 - 24,
    LOGICAL_HEIGHT - 8 - 48 - bounce,
    48,
    48,
  );
  context.fillStyle = "rgba(10, 4, 18, .5)";
  context.fillRect(LOGICAL_WIDTH / 2 - 14, LOGICAL_HEIGHT - 10, 28, 3);

  // crowd bar along the bottom edge — shape + the DOM HUD number
  context.fillStyle = COLORS.inkDeep;
  context.fillRect(0, LOGICAL_HEIGHT - 6, LOGICAL_WIDTH, 6);
  context.fillStyle = world.crowd < 25 ? COLORS.danger : COLORS.pinkHot;
  context.fillRect(0, LOGICAL_HEIGHT - 5, (world.crowd / 100) * LOGICAL_WIDTH, 4);

  if (world.judgement) {
    context.fillStyle =
      world.judgement === "perfect"
        ? COLORS.cream
        : world.judgement === "good"
          ? COLORS.teal
          : COLORS.danger;
    context.font = "bold 10px monospace";
    context.textAlign = "center";
    context.fillText(world.judgement.toUpperCase(), LOGICAL_WIDTH / 2, DANCE_FLOOR_Y - 4);
    context.textAlign = "left";
  }
};

/* ══ SOCCER ═══════════════════════════════════════════════════════════════ */

const drawSoccer = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: SoccerWorld,
  options: ModeRenderOptions,
) => {
  context.fillStyle = COLORS.inkDeep;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // night crowd band
  for (let column = -1; column < 6; column += 1) {
    draw(context, atlas, "tile_city_04", column * 64, -8, 64, 64);
  }
  context.fillStyle = "rgba(10, 4, 18, .55)";
  context.fillRect(0, 0, LOGICAL_WIDTH, 48);

  // pitch
  context.fillStyle = COLORS.greenDeep;
  context.fillRect(0, 48, LOGICAL_WIDTH, LOGICAL_HEIGHT - 48);
  context.fillStyle = COLORS.green;
  for (let x = 0; x < LOGICAL_WIDTH; x += 40) {
    context.globalAlpha = 0.18;
    context.fillRect(x, 48, 20, LOGICAL_HEIGHT - 48);
    context.globalAlpha = 1;
  }
  context.strokeStyle = COLORS.cream;
  context.lineWidth = 1;
  context.globalAlpha = 0.6;
  context.strokeRect(10.5, 60.5, LOGICAL_WIDTH - 21, LOGICAL_HEIGHT - 74);
  context.beginPath();
  context.moveTo(LOGICAL_WIDTH / 2 + 0.5, 60);
  context.lineTo(LOGICAL_WIDTH / 2 + 0.5, LOGICAL_HEIGHT - 14);
  context.stroke();
  context.beginPath();
  context.arc(LOGICAL_WIDTH / 2, 118, 22, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;

  // goals sit at both touchlines; the left one is yours
  const goalY = SOCCER_GROUND - SOCCER_GOAL_HEIGHT;
  draw(context, atlas, "soccer_goal", 0, goalY, 32, SOCCER_GOAL_HEIGHT, true);
  draw(context, atlas, "soccer_goal", LOGICAL_WIDTH - 32, goalY, 32, SOCCER_GOAL_HEIGHT);

  const step = Math.floor(world.time * 6) % 4;
  const opponent: CharacterId = options.character === "tj" ? "ta" : "tj";
  const pose = (actor: { onGround: boolean }) => (actor.onGround ? "run" : "jump");
  draw(
    context,
    atlas,
    `${options.character}_${pose(world.player)}_${step}`,
    world.player.x - 24,
    world.player.y - 48,
    48,
    48,
  );
  draw(
    context,
    atlas,
    `${opponent}_${pose(world.opponent)}_${step}`,
    world.opponent.x - 24,
    world.opponent.y - 48,
    48,
    48,
    true,
  );

  const spin = options.reducedMotion ? 0 : Math.floor(world.time * 8) % 2;
  draw(context, atlas, `soccer_ball_${spin}`, world.ball.x - 8, world.ball.y - 8, 16, 16);

  if (world.goalFlashMs > 0) {
    context.fillStyle = "rgba(250, 224, 140, .22)";
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.fillStyle = COLORS.cream;
    context.font = "bold 14px monospace";
    context.textAlign = "center";
    context.fillText("GOAL!", LOGICAL_WIDTH / 2, 100);
    context.textAlign = "left";
  }
};

/* ══ DRIVE ════════════════════════════════════════════════════════════════ */

const DRIVE_HORIZON = 80;
const DRIVE_VIEW_DEPTH = 260;
const DRIVE_ROAD_TOP_HALF = 10;
const DRIVE_ROAD_BOTTOM_HALF = 132;

/** 0 = at the car, 1 = at the horizon. */
const driveProject = (z: number) => {
  const t = Math.pow(1 - z, 2.1);
  return {
    y: DRIVE_HORIZON + (LOGICAL_HEIGHT - DRIVE_HORIZON) * t,
    half: DRIVE_ROAD_TOP_HALF + (DRIVE_ROAD_BOTTOM_HALF - DRIVE_ROAD_TOP_HALF) * t,
    scale: 0.18 + 0.82 * t,
  };
};

const drawDrive = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: DriveWorld,
  options: ModeRenderOptions,
) => {
  context.fillStyle = COLORS.inkDeep;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Sunset: the bands repeat across the width, but the sun must not. The band
  // tile is blitted once in the middle and the identical band colours fill the
  // rest, so the seam is invisible and exactly one sun is on screen.
  const skyTop = DRIVE_HORIZON - 50;
  context.fillStyle = COLORS.inkFar;
  context.fillRect(0, 0, LOGICAL_WIDTH, skyTop);
  const bands: [number, number, string][] = [
    [0, 6, "#2b214c"],
    [6, 5, "#150e2a"],
    [11, 6, "#e05695"],
    [17, 6, "#dc6913"],
    [23, 9, "#f79629"],
  ];
  for (const [offset, height, colour] of bands) {
    context.fillStyle = colour;
    context.fillRect(0, skyTop + offset, LOGICAL_WIDTH, height);
  }
  draw(context, atlas, "sunset_far", LOGICAL_WIDTH / 2 - 32, skyTop, 64, 32);

  // Skyline: only the 18 rows above the horizon are shown, so the bottom-aligned
  // buildings read as one silhouette against the glow instead of a repeating comb.
  const glowTop = skyTop + 32;
  context.fillStyle = "#d9ba57";
  context.fillRect(0, glowTop, LOGICAL_WIDTH, DRIVE_HORIZON - glowTop);
  context.save();
  context.beginPath();
  context.rect(0, glowTop, LOGICAL_WIDTH, DRIVE_HORIZON - glowTop);
  context.clip();
  for (let column = 0; column < 5; column += 1) {
    draw(context, atlas, "sunset_near", column * 64, DRIVE_HORIZON - 32, 64, 32);
  }
  context.restore();

  // road surface as a trapezoid
  const center = LOGICAL_WIDTH / 2;
  context.fillStyle = COLORS.ink;
  context.beginPath();
  context.moveTo(center - DRIVE_ROAD_TOP_HALF, DRIVE_HORIZON);
  context.lineTo(center + DRIVE_ROAD_TOP_HALF, DRIVE_HORIZON);
  context.lineTo(center + DRIVE_ROAD_BOTTOM_HALF, LOGICAL_HEIGHT);
  context.lineTo(center - DRIVE_ROAD_BOTTOM_HALF, LOGICAL_HEIGHT);
  context.closePath();
  context.fill();

  // verge
  context.strokeStyle = COLORS.purple;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center - DRIVE_ROAD_TOP_HALF, DRIVE_HORIZON);
  context.lineTo(center - DRIVE_ROAD_BOTTOM_HALF, LOGICAL_HEIGHT);
  context.moveTo(center + DRIVE_ROAD_TOP_HALF, DRIVE_HORIZON);
  context.lineTo(center + DRIVE_ROAD_BOTTOM_HALF, LOGICAL_HEIGHT);
  context.stroke();

  // centre dashes scroll with distance; frozen for reduced motion
  const phase = options.reducedMotion ? 0 : (world.distance % 40) / 40;
  context.fillStyle = COLORS.cream;
  for (let index = 0; index < 9; index += 1) {
    const z = ((index + phase) / 9) * 0.98;
    const near = driveProject(z);
    const far = driveProject(Math.min(0.98, z + 0.05));
    const width = Math.max(1, near.scale * 4);
    context.fillRect(center - width / 2, far.y, width, Math.max(1, near.y - far.y));
  }

  // hazards approach from the horizon
  for (const hazard of world.hazards) {
    if (hazard.spent) continue;
    const ahead = hazard.distance - world.distance;
    if (ahead < -10) continue;
    if (ahead > DRIVE_VIEW_DEPTH) break;
    const z = ahead / DRIVE_VIEW_DEPTH;
    const { y, half, scale } = driveProject(z);
    const x = center + hazard.offset * half * 0.72;
    const size = Math.max(3, Math.round(20 * scale));
    if (hazard.kind === "heart") {
      context.fillStyle = COLORS.pinkHot;
      context.fillRect(x - size / 2, y - size, size, size * 0.7);
      context.fillStyle = COLORS.pink;
      context.fillRect(x - size / 4, y - size * 1.2, size / 2, size / 2);
    } else {
      context.fillStyle = COLORS.purpleDeep;
      context.strokeStyle = COLORS.pinkHot;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y - size);
      context.lineTo(x + size / 2, y - size / 2);
      context.lineTo(x, y);
      context.lineTo(x - size / 2, y - size / 2);
      context.closePath();
      context.fill();
      context.stroke();
    }
  }

  // shot tracer
  if (world.shotMs > 0) {
    context.fillStyle = COLORS.cream;
    context.fillRect(center - 1, DRIVE_HORIZON, 2, LOGICAL_HEIGHT - DRIVE_HORIZON - 30);
  }

  // the car, lifted while airborne
  const lift = world.jumpMs > 0 ? Math.sin((1 - world.jumpMs / 760) * Math.PI) * 26 : 0;
  const flicker =
    world.invulnerableMs > 0 && Math.floor(world.invulnerableMs / 90) % 2 === 0;
  if (lift > 1) {
    context.fillStyle = "rgba(10, 4, 18, .55)";
    context.fillRect(center - 20, LOGICAL_HEIGHT - 18, 40, 4);
  }
  if (!flicker) {
    draw(context, atlas, "drive_car", center - 24, LOGICAL_HEIGHT - 34 - lift, 48, 24);
  }

  // boost streaks at the edges only — the road centre stays clear
  if (world.boost >= 99 && !options.reducedMotion) {
    context.fillStyle = COLORS.gold;
    for (let index = 0; index < 4; index += 1) {
      const y = 96 + ((world.distance * 3 + index * 26) % 80);
      context.fillRect(6, y, 3, 12);
      context.fillRect(LOGICAL_WIDTH - 9, y + 8, 3, 12);
    }
  }

  // hearts remaining as shapes inside the frame, mirroring the DOM HUD text
  for (let index = 0; index < DRIVE_MAX_HP; index += 1) {
    context.fillStyle = index < world.hp ? COLORS.pinkHot : "rgba(255, 252, 246, .25)";
    context.fillRect(LOGICAL_WIDTH - 12 - index * 8, skyTop - 9, 5, 5);
  }

  if (world.status) {
    context.fillStyle = COLORS.cream;
    context.font = "bold 9px monospace";
    context.textAlign = "center";
    context.fillText(world.status, center, DRIVE_HORIZON - 8);
    context.textAlign = "left";
  }

  // distance ribbon at the very bottom, shape + the DOM HUD number
  context.fillStyle = "rgba(10, 4, 18, .8)";
  context.fillRect(0, LOGICAL_HEIGHT - 4, LOGICAL_WIDTH, 4);
  context.fillStyle = COLORS.gold;
  context.fillRect(0, LOGICAL_HEIGHT - 3, (world.distance / DRIVE_DISTANCE) * LOGICAL_WIDTH, 2);
};

/* ══ entry points ═════════════════════════════════════════════════════════ */

export const renderMode = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: ModeWorld,
  options: ModeRenderOptions,
) => {
  context.imageSmoothingEnabled = false;
  if (world.mode === "dance") drawDance(context, atlas, world, options);
  else if (world.mode === "soccer") drawSoccer(context, atlas, world, options);
  else drawDrive(context, atlas, world, options);
};

/** Static frame shown before a set starts, so the canvas is never blank. */
export const renderModeIdle = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas | null,
  world: ModeWorld,
  options: ModeRenderOptions,
) => {
  context.imageSmoothingEnabled = false;
  if (!atlas) {
    context.fillStyle = COLORS.inkDeep;
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.fillStyle = COLORS.cream;
    context.font = "bold 10px monospace";
    context.fillText("SOUNDCHECK...", 116, 92);
    return;
  }
  renderMode(context, atlas, world, options);
};

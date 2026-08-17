import type { LoadedAtlas } from "./atlas";
import {
  GROUND_Y,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PLAYER_HEIGHT,
  type World,
  type ZoneId,
  isOverPit,
} from "./simulation";

/** Palette pulled from the design tokens (`tokens.json`). */
const COLORS = {
  ink: "#20143a",
  inkDeep: "#0a0412",
  inkFar: "#161b34",
  cream: "#fae08c",
  white: "#fffcf6",
  pinkHot: "#f5187c",
  gold: "#f7be3c",
  teal: "#2ab6a8",
  greenDeep: "#148c54",
  purpleDeep: "#4a2274",
  danger: "#ff4b4b",
} as const;

const ZONE_SKY: Record<ZoneId, string> = {
  jungle: "#0b2418",
  city: "#161b34",
  stage: "#2a1030",
};

const ZONE_HAZE: Record<ZoneId, string> = {
  jungle: "rgba(20, 140, 84, .28)",
  city: "rgba(32, 20, 58, .36)",
  stage: "rgba(245, 24, 124, .18)",
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  frame: string;
};

export type RenderOptions = {
  /** `prefers-reduced-motion` freezes non-essential motion (parallax, sparkle). */
  reducedMotion: boolean;
  particles: Particle[];
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
    context.drawImage(
      atlas.image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      width,
      height,
    );
    context.restore();
    return;
  }
  context.drawImage(
    atlas.image,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    dx,
    dy,
    width,
    height,
  );
};

const runFrameIndex = (world: World) => Math.floor(world.camera / 12) % 4;

const jumpFrameIndex = (world: World) => {
  if (world.velocityY < -60) return 1;
  if (world.velocityY < 60) return 2;
  return 3;
};

/** Tiles are 16px art meant to be shown at integer 2×/4× scale (design prototype). */
const drawBackground = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: World,
  options: RenderOptions,
) => {
  const zone = world.zone;
  const camera = options.reducedMotion ? 0 : world.camera;

  context.fillStyle = ZONE_SKY[zone];
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // far backdrop — quarter speed
  const farOffset = Math.floor((camera * 0.25) % 64);
  for (let column = -1; column < 6; column += 1) {
    draw(
      context,
      atlas,
      `tile_${zone}_04`,
      column * 64 - farOffset,
      44,
      64,
      64,
    );
  }
  context.fillStyle = "rgba(10, 4, 18, .3)";
  context.fillRect(0, 44, LOGICAL_WIDTH, 72);

  // mid props — half speed, three different silhouettes so the band reads as a place
  const midOffset = Math.floor((camera * 0.5) % 88);
  const midFrames = [`tile_${zone}_01`, `tile_${zone}_03`, `tile_${zone}_00`];
  for (let column = -1; column < 5; column += 1) {
    const worldColumn = column + Math.floor((camera * 0.5) / 88);
    const frame = midFrames[((worldColumn % 3) + 3) % 3];
    const lift = [48, 58, 52][((worldColumn % 3) + 3) % 3];
    draw(context, atlas, frame, column * 88 - midOffset, lift, 64, 64);
  }
  // Push the whole backdrop behind the runner lane (100–148) so the 48px sprite reads.
  context.fillStyle = "rgba(10, 4, 18, .32)";
  context.fillRect(0, 44, LOGICAL_WIDTH, 104);
  context.fillStyle = ZONE_HAZE[zone];
  context.fillRect(0, 100, LOGICAL_WIDTH, 48);
};

const drawGround = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: World,
) => {
  const zone = world.zone;
  const start = Math.floor(world.camera / 32) * 32;
  for (let index = -1; index < 12; index += 1) {
    const worldX = start + index * 32;
    const screenX = worldX - world.camera;
    if (isOverPit(world.level, worldX + 16)) {
      context.fillStyle = COLORS.inkDeep;
      context.fillRect(
        Math.round(screenX),
        GROUND_Y,
        32,
        LOGICAL_HEIGHT - GROUND_Y,
      );
      continue;
    }
    draw(context, atlas, `tile_${zone}_02`, screenX, GROUND_Y, 32, 32);
  }
};

export const renderWorld = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas,
  world: World,
  options: RenderOptions,
) => {
  context.imageSmoothingEnabled = false;
  context.save();

  if (world.shakeMs > 0 && !options.reducedMotion) {
    const amount = Math.round((world.shakeMs / 260) * 3);
    context.translate(
      (Math.random() - 0.5) * amount * 2,
      (Math.random() - 0.5) * amount,
    );
  }

  drawBackground(context, atlas, world, options);
  drawGround(context, atlas, world);

  const toScreen = (worldX: number) => worldX - world.camera;

  for (const prop of world.level.props) {
    const screenX = toScreen(prop.x);
    if (screenX < -32 || screenX > LOGICAL_WIDTH + 32) continue;
    draw(context, atlas, prop.frame, screenX - 8, prop.y - 16, 16, 16);
  }

  for (const checkpoint of world.level.checkpoints) {
    const screenX = toScreen(checkpoint.x);
    if (screenX < -32 || screenX > LOGICAL_WIDTH + 32) continue;
    draw(
      context,
      atlas,
      checkpoint.reached ? "flag_on" : "flag_off",
      screenX - 8,
      GROUND_Y - 32,
      16,
      32,
    );
  }

  for (const platform of world.level.platforms) {
    const screenX = toScreen(platform.x);
    if (screenX < -48 || screenX > LOGICAL_WIDTH + 48) continue;
    const y =
      platform.y + Math.sin(world.time * 1.6 + platform.x) * platform.bob;
    draw(context, atlas, "obs_platform", screenX - 3, y - 10, 32, 32);
  }

  for (const obstacle of world.level.obstacles) {
    const screenX = toScreen(obstacle.x);
    if (screenX < -110 || screenX > LOGICAL_WIDTH + 110) continue;
    if (obstacle.kind === "large") {
      draw(context, atlas, "boss_large_0", screenX - 48, GROUND_Y - 96, 96, 96);
      continue;
    }
    if (obstacle.spent) continue;
    if (obstacle.kind === "falling") {
      const trigger = obstacle.triggerX ?? obstacle.x;
      const fallen =
        world.camera < trigger
          ? 0
          : Math.min(GROUND_Y - obstacle.y, (world.camera - trigger) * 1.5);
      draw(
        context,
        atlas,
        "obs_falling_light",
        screenX - 16,
        obstacle.y + fallen - 32,
        32,
        32,
      );
      continue;
    }
    draw(
      context,
      atlas,
      obstacle.kind === "cable" ? "obs_mic_cable" : "obs_road_case",
      screenX - 16,
      GROUND_Y - 32,
      32,
      32,
    );
  }

  for (const enemy of world.level.enemies) {
    if (enemy.defeated) continue;
    const enemyX = enemy.x + Math.sin(world.time * 2.2 + enemy.x) * enemy.sway;
    const screenX = toScreen(enemyX);
    if (screenX < -40 || screenX > LOGICAL_WIDTH + 40) continue;
    const step = Math.floor(world.time * 4) % 2;
    draw(
      context,
      atlas,
      `enemy_${enemy.zone}_${step}`,
      screenX - 16,
      enemy.y - 32,
      32,
      32,
      true,
    );
  }

  const itemStep = Math.floor(world.time * 6) % 2;
  for (const item of world.level.items) {
    if (item.taken) continue;
    const screenX = toScreen(item.x);
    if (screenX < -20) continue;
    if (screenX > LOGICAL_WIDTH + 20) break;
    draw(
      context,
      atlas,
      `item_${item.kind}_${itemStep}`,
      screenX - 8,
      item.y - 16,
      16,
      16,
    );
  }

  /* runner */
  const character = world.character.id;
  const flicker =
    world.invulnerableMs > 0 && Math.floor(world.invulnerableMs / 80) % 2 === 0;
  if (!flicker) {
    const action = world.onGround ? "run" : "jump";
    const index = world.onGround ? runFrameIndex(world) : jumpFrameIndex(world);
    draw(
      context,
      atlas,
      `${character}_${action}_${index}`,
      world.playerX - 24,
      world.playerY - 48,
      48,
      48,
    );
  }

  if (world.attackMs > 0) {
    context.fillStyle = COLORS.cream;
    context.globalAlpha = 0.75;
    const reach = world.character.attackReach;
    context.fillRect(
      Math.round(world.playerX + 6),
      Math.round(world.playerY - PLAYER_HEIGHT + 6),
      reach - 6,
      4,
    );
    context.globalAlpha = 1;
  }

  /* particles */
  for (const particle of options.particles) {
    const screenX = particle.x - world.camera;
    if (screenX < -16 || screenX > LOGICAL_WIDTH + 16) continue;
    context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    draw(context, atlas, particle.frame, screenX - 8, particle.y - 8, 16, 16);
    context.globalAlpha = 1;
  }

  /* fever */
  if (world.fever) {
    context.globalCompositeOperation = "screen";
    context.fillStyle = "rgba(245, 24, 124, .2)";
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.globalCompositeOperation = "source-over";
    if (!options.reducedMotion) {
      for (let index = 0; index < 4; index += 1) {
        const angle = world.time * 3 + (index * Math.PI) / 2;
        draw(
          context,
          atlas,
          `fx_fever_${index}`,
          world.playerX - 8 + Math.cos(angle) * 26,
          world.playerY - 26 + Math.sin(angle) * 16,
          16,
          16,
        );
      }
    }
    context.fillStyle = COLORS.gold;
    context.fillRect(0, 0, LOGICAL_WIDTH, 2);
    context.fillRect(0, LOGICAL_HEIGHT - 2, LOGICAL_WIDTH, 2);
  }

  context.restore();
};

/** Title/idle frame shown before the first run so the canvas is never blank (spec §8 A7). */
export const renderIdle = (
  context: CanvasRenderingContext2D,
  atlas: LoadedAtlas | null,
  character: "tj" | "ta",
) => {
  context.imageSmoothingEnabled = false;
  context.fillStyle = COLORS.inkDeep;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  if (!atlas) {
    context.fillStyle = COLORS.cream;
    context.font = "bold 10px monospace";
    context.fillText("SOUNDCHECK...", 116, 92);
    return;
  }
  context.fillStyle = ZONE_SKY.city;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  for (let column = -1; column < 6; column += 1) {
    draw(context, atlas, "tile_city_04", column * 64, 44, 64, 64);
  }
  context.fillStyle = "rgba(10, 4, 18, .42)";
  context.fillRect(0, 44, LOGICAL_WIDTH, 72);
  for (let column = -1; column < 12; column += 1) {
    draw(context, atlas, "tile_city_02", column * 32, GROUND_Y, 32, 32);
  }
  draw(context, atlas, `${character}_idle_0`, 136, GROUND_Y - 48, 48, 48);
};

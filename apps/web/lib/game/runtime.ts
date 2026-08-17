import type { LoadedAtlas } from "./atlas";
import { GameAudio } from "./audio";
import { type Particle, renderIdle, renderWorld } from "./renderer";
import {
  type CharacterId,
  type GameEvent,
  type InputState,
  type RunSummary,
  type World,
  createWorld,
  emptyInput,
  multiplierOf,
  remainingRatio,
  stepWorld,
  summarize,
  zoneLabel,
} from "./simulation";

export type HudSnapshot = {
  score: number;
  combo: number;
  multiplier: number;
  fever: boolean;
  feverRatio: number;
  remaining: number;
  zoneLabel: string;
  zoneIndex: number;
  seconds: number;
};

export type RuntimeCallbacks = {
  onHud: (hud: HudSnapshot) => void;
  onFinish: (summary: RunSummary) => void;
  onCheckpoint: () => void;
};

const HUD_INTERVAL_MS = 90;

const hudOf = (world: World): HudSnapshot => ({
  score: world.score,
  combo: world.combo,
  multiplier: multiplierOf(world.combo),
  fever: world.fever,
  feverRatio: world.fever ? 1 : Math.min(1, world.combo / 10),
  remaining: remainingRatio(world),
  zoneLabel: zoneLabel(world.zone),
  zoneIndex: world.zone === "jungle" ? 0 : world.zone === "city" ? 1 : 2,
  seconds: Math.floor(world.time),
});

/**
 * Owns the canvas, the animation frame loop and the input state. Deliberately
 * framework-free so the React shell only renders DOM and forwards intents.
 */
export class GameRuntime {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private atlas: LoadedAtlas | null = null;
  private world: World | null = null;
  private frame = 0;
  private lastTime = 0;
  private hudTime = 0;
  private particles: Particle[] = [];
  private input: InputState = emptyInput();
  private held = { left: false, right: false };
  private callbacks: RuntimeCallbacks;
  private idleCharacter: CharacterId = "tj";
  readonly audio = new GameAudio();
  reducedMotion = false;

  constructor(callbacks: RuntimeCallbacks) {
    this.callbacks = callbacks;
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (this.context) this.context.imageSmoothingEnabled = false;
  }

  setAtlas(atlas: LoadedAtlas) {
    this.atlas = atlas;
    this.drawIdle(this.idleCharacter);
  }

  drawIdle(character: CharacterId) {
    this.idleCharacter = character;
    if (!this.context) return;
    renderIdle(this.context, this.atlas, character);
  }

  start(character: CharacterId) {
    this.stop();
    this.world = createWorld(character);
    this.particles = [];
    this.input = emptyInput();
    this.held = { left: false, right: false };
    this.lastTime = 0;
    this.hudTime = 0;
    this.audio.setZone("jungle");
    this.audio.setFever(false);
    if (this.audio.enabled) this.audio.startMusic();
    this.callbacks.onHud(hudOf(this.world));
    this.frame = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.audio.stopMusic();
  }

  dispose() {
    this.stop();
    this.audio.dispose();
  }

  /* input intents ------------------------------------------------------- */

  setDirection(direction: "left" | "right", pressed: boolean) {
    this.held[direction] = pressed;
  }

  pressJump() {
    this.input.jumpPressed = true;
  }

  pressAction() {
    this.input.actionPressed = true;
  }

  private spawnParticles(event: GameEvent) {
    if (this.reducedMotion) return;
    if (event.kind === "item") {
      for (let index = 0; index < 3; index += 1) {
        this.particles.push({
          x: event.x,
          y: event.y,
          vx: (Math.random() - 0.5) * 40,
          vy: -30 - Math.random() * 40,
          life: 0.4,
          maxLife: 0.4,
          frame: `fx_collect_${index % 6}`,
        });
      }
      return;
    }
    if (event.kind === "enemy") {
      for (let index = 0; index < 4; index += 1) {
        this.particles.push({
          x: event.x,
          y: event.y - 12,
          vx: (Math.random() - 0.5) * 70,
          vy: -50 - Math.random() * 40,
          life: 0.5,
          maxLife: 0.5,
          frame: "shard",
        });
      }
    }
  }

  private handleEvents(world: World) {
    for (const event of world.events) {
      this.spawnParticles(event);
      switch (event.kind) {
        case "jump":
          this.audio.jump(event.double);
          break;
        case "item":
          this.audio.collect();
          break;
        case "enemy":
          this.audio.enemy();
          break;
        case "hit":
          this.audio.hit();
          break;
        case "fever-start":
          this.audio.setFever(true);
          this.audio.feverStart();
          break;
        case "fever-end":
          this.audio.setFever(false);
          break;
        case "zone":
          this.audio.setZone(event.zone);
          break;
        case "checkpoint":
          this.audio.checkpoint();
          this.callbacks.onCheckpoint();
          break;
        default:
          break;
      }
    }
    world.events.length = 0;
  }

  private tick = (now: number) => {
    const world = this.world;
    const context = this.context;
    if (!world || !context) return;

    const dt =
      this.lastTime === 0
        ? 1 / 60
        : Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.input.left = this.held.left;
    this.input.right = this.held.right;
    stepWorld(world, dt, this.input);
    this.input.jumpPressed = false;
    this.input.actionPressed = false;

    this.handleEvents(world);

    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 180 * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);

    if (this.atlas) {
      renderWorld(context, this.atlas, world, {
        reducedMotion: this.reducedMotion,
        particles: this.particles,
      });
    }

    this.hudTime += dt * 1000;
    if (this.hudTime >= HUD_INTERVAL_MS) {
      this.hudTime = 0;
      this.callbacks.onHud(hudOf(world));
    }

    if (world.finished) {
      this.callbacks.onHud(hudOf(world));
      this.stop();
      this.callbacks.onFinish(summarize(world));
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}

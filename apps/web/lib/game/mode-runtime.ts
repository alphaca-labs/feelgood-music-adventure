import type { LoadedAtlas } from "./atlas";
import { GameAudio } from "./audio";
import { renderMode, renderModeIdle } from "./mode-renderer";
import {
  type ModeEvent,
  type ModeHud,
  type ModeId,
  type ModeInput,
  type ModeSummary,
  type ModeWorld,
  createModeWorld,
  emptyModeInput,
  hudOfMode,
  stepModeWorld,
  summarizeMode,
} from "./mode-simulation";
import type { CharacterId } from "./simulation";

export type ModeRuntimeCallbacks = {
  onHud: (hud: ModeHud) => void;
  onFinish: (summary: ModeSummary) => void;
  /** Short sentence for the shared polite live region. */
  onAnnounce: (message: string) => void;
};

const HUD_INTERVAL_MS = 90;

const announcementOf = (event: ModeEvent): string | null => {
  switch (event.kind) {
    case "judge":
      return event.judgement === "perfect"
        ? "퍼펙트"
        : event.judgement === "good"
          ? "굿"
          : "미스";
    case "goal":
      return event.scorer === "you" ? "골, 내 점수 상승" : "실점";
    case "save":
      return "세이브";
    case "smash":
      return "장애물 격파";
    case "heart":
      return "부스트 충전";
    case "damage":
      return `피격, 남은 HP ${event.hp}`;
    default:
      return null;
  }
};

/**
 * Owns the canvas, the frame loop and the input state for one mode set.
 * Deliberately mirrors `GameRuntime` (the adventure runner) so the React shell
 * only renders DOM and forwards intents — the runner itself is untouched.
 */
export class ModeRuntime {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private atlas: LoadedAtlas | null = null;
  private world: ModeWorld | null = null;
  private frame = 0;
  private lastTime = 0;
  private hudTime = 0;
  private input: ModeInput = emptyModeInput();
  private held = { left: false, right: false };
  private callbacks: ModeRuntimeCallbacks;
  private mode: ModeId = "dance";
  private character: CharacterId = "tj";
  readonly audio = new GameAudio();
  reducedMotion = false;

  constructor(callbacks: ModeRuntimeCallbacks) {
    this.callbacks = callbacks;
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (this.context) this.context.imageSmoothingEnabled = false;
  }

  setAtlas(atlas: LoadedAtlas) {
    this.atlas = atlas;
    this.drawIdle(this.mode, this.character);
  }

  drawIdle(mode: ModeId, character: CharacterId) {
    this.mode = mode;
    this.character = character;
    if (!this.context) return;
    renderModeIdle(this.context, this.atlas, this.world ?? createModeWorld(mode), {
      reducedMotion: this.reducedMotion,
      character,
    });
  }

  start(mode: ModeId, character: CharacterId) {
    this.stop();
    this.mode = mode;
    this.character = character;
    this.world = createModeWorld(mode);
    this.input = emptyModeInput();
    this.held = { left: false, right: false };
    this.lastTime = 0;
    this.hudTime = 0;
    this.audio.setZone(mode === "drive" ? "city" : "stage");
    this.audio.setFever(false);
    if (this.audio.enabled) this.audio.startMusic();
    this.callbacks.onHud(hudOfMode(this.world));
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

  /** Held for soccer/drive; the same press also feeds the dance lane edge. */
  setDirection(direction: "left" | "right", pressed: boolean) {
    this.held[direction] = pressed;
    if (!pressed) return;
    if (direction === "left") this.input.leftPressed = true;
    else this.input.rightPressed = true;
  }

  pressA() {
    this.input.aPressed = true;
  }

  pressB() {
    this.input.bPressed = true;
  }

  private handleEvents(world: ModeWorld) {
    for (const event of world.events) {
      switch (event.kind) {
        case "judge":
          if (event.judgement === "miss") this.audio.hit();
          else this.audio.collect();
          break;
        case "goal":
          if (event.scorer === "you") this.audio.checkpoint();
          else this.audio.hit();
          break;
        case "kick":
        case "save":
        case "smash":
          this.audio.enemy();
          break;
        case "heart":
          this.audio.collect();
          break;
        case "jump":
          this.audio.jump(event.double);
          break;
        case "damage":
          this.audio.hit();
          break;
        default:
          break;
      }
      const message = announcementOf(event);
      if (message) this.callbacks.onAnnounce(message);
    }
    world.events.length = 0;
  }

  private tick = (now: number) => {
    const world = this.world;
    const context = this.context;
    if (!world || !context) return;

    const dt =
      this.lastTime === 0 ? 1 / 60 : Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.input.left = this.held.left;
    this.input.right = this.held.right;
    stepModeWorld(world, dt, this.input);
    this.input.leftPressed = false;
    this.input.rightPressed = false;
    this.input.aPressed = false;
    this.input.bPressed = false;

    this.handleEvents(world);

    if (this.atlas) {
      renderMode(context, this.atlas, world, {
        reducedMotion: this.reducedMotion,
        character: this.character,
      });
    }

    this.hudTime += dt * 1000;
    if (this.hudTime >= HUD_INTERVAL_MS) {
      this.hudTime = 0;
      this.callbacks.onHud(hudOfMode(world));
    }

    if (world.finished) {
      this.callbacks.onHud(hudOfMode(world));
      this.stop();
      this.callbacks.onFinish(summarizeMode(world));
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}

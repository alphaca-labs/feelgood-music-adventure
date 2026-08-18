"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ASSET_VERSION, type LoadedAtlas } from "@/lib/game/atlas";
import { ModeRuntime } from "@/lib/game/mode-runtime";
import {
  DRIVE_DISTANCE,
  DRIVE_MAX_HP,
  type ModeHud,
  type ModeId,
  type ModeSummary,
  SOCCER_TARGET,
  emptyModeHud,
  formatClock,
  formatMeters,
  formatScore,
} from "@/lib/game/mode-simulation";
import { MODE_COPY, splitHeadline } from "@/lib/game/modes";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, type CharacterId } from "@/lib/game/simulation";
import { assetUrl } from "@/lib/site";

export type ModeStageProps = {
  mode: ModeId;
  character: CharacterId;
  sound: boolean;
  atlas: LoadedAtlas | null;
  loadState: "loading" | "ready" | "error";
  onRetryLoad: () => void;
  onToggleSound: () => void;
  onAnnounce: (message: string) => void;
  /** Back to the title setlist. */
  onChangeMode: () => void;
};

type ModeScene = "start" | "play" | "result";

const MAX_SCALE = 4;

const integerScale = (width: number, height: number) =>
  Math.max(
    1,
    Math.min(
      MAX_SCALE,
      Math.floor(Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)),
    ),
  );

const posterUrl = (character: CharacterId) =>
  `${assetUrl(`/assets/ui-pose-${character}.png`)}?v=${ASSET_VERSION}`;

const hearts = (hp: number) =>
  `${"♥".repeat(Math.max(0, hp))}${"♡".repeat(Math.max(0, DRIVE_MAX_HP - hp))}`;

const JUDGEMENT_COPY = {
  perfect: "PERFECT",
  good: "GOOD",
  miss: "MISS",
} as const;

/**
 * The three mode sets (DANCE / SOCCER / DRIVE) as one stage: intro ticket →
 * play → result. It reuses the existing shell primitives (`.scene`,
 * `.game-frame`, `.touch-deck`, `.result-pass`) instead of introducing a second
 * layout system, and owns its own {@link ModeRuntime} so the adventure runner's
 * runtime is never started or stopped by a mode.
 *
 * The shell mounts this with a `mode`/`character` key, so switching sets remounts
 * the stage instead of resetting five pieces of state from an effect.
 */
const ModeStage = ({
  mode,
  character,
  sound,
  atlas,
  loadState,
  onRetryLoad,
  onToggleSound,
  onAnnounce,
  onChangeMode,
}: ModeStageProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<ModeRuntime | null>(null);
  const stageSlotRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ModeScene>("start");
  const lastAnnouncement = useRef("");

  const [scene, setScene] = useState<ModeScene>("start");
  const [hud, setHud] = useState<ModeHud>(() => emptyModeHud(mode));
  const [summary, setSummary] = useState<ModeSummary | null>(null);

  const copy = MODE_COPY[mode];

  const goto = useCallback((next: ModeScene) => {
    sceneRef.current = next;
    setScene(next);
  }, []);

  /* runtime ------------------------------------------------------------- */
  useEffect(() => {
    const runtime = new ModeRuntime({
      onHud: setHud,
      onFinish: (result) => {
        setSummary(result);
        goto("result");
      },
      onAnnounce: (message) => {
        // the same judgement repeats up to 157 times per set; only changes speak
        if (message === lastAnnouncement.current) return;
        lastAnnouncement.current = message;
        onAnnounce(message);
      },
    });
    runtimeRef.current = runtime;
    if (canvasRef.current) runtime.attach(canvasRef.current);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    runtime.reducedMotion = motionQuery.matches;
    const onMotionChange = () => {
      runtime.reducedMotion = motionQuery.matches;
    };
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [goto, onAnnounce]);

  useEffect(() => {
    if (atlas) runtimeRef.current?.setAtlas(atlas);
  }, [atlas]);

  useEffect(() => {
    runtimeRef.current?.audio.setEnabled(sound);
  }, [sound]);

  /* canvas scale (same integer-only contract as the runner) -------------- */
  useEffect(() => {
    const slot = stageSlotRef.current;
    if (!slot) return;
    const apply = () => {
      const box = slot.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      document.documentElement.style.setProperty(
        "--game-scale",
        String(integerScale(box.width, box.height)),
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(slot);
    window.addEventListener("orientationchange", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", apply);
    };
  }, [scene]);

  /* keyboard ------------------------------------------------------------- */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || sceneRef.current !== "play") return;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (event.code === "ArrowLeft") runtime.setDirection("left", true);
      if (event.code === "ArrowRight") runtime.setDirection("right", true);
      if (["Space", "ArrowUp", "KeyZ"].includes(event.code)) {
        event.preventDefault();
        runtime.pressA();
      }
      if (["ArrowDown", "KeyX", "Enter"].includes(event.code)) {
        event.preventDefault();
        runtime.pressB();
      }
    };
    const up = (event: KeyboardEvent) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (event.code === "ArrowLeft") runtime.setDirection("left", false);
      if (event.code === "ArrowRight") runtime.setDirection("right", false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const startRun = useCallback(() => {
    if (loadState !== "ready") {
      onRetryLoad();
      return;
    }
    setSummary(null);
    setHud(emptyModeHud(mode));
    lastAnnouncement.current = "";
    goto("play");
    onAnnounce(`${copy.label} 게임 플레이`);
    window.requestAnimationFrame(() => runtimeRef.current?.start(mode, character));
  }, [character, copy.label, goto, loadState, mode, onAnnounce, onRetryLoad]);

  const quit = useCallback(() => {
    runtimeRef.current?.stop();
    runtimeRef.current?.drawIdle(mode, character);
    goto("start");
    onAnnounce(`${copy.label} 시작 안내`);
  }, [character, copy.label, goto, mode, onAnnounce]);

  const hold = (direction: "left" | "right") => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      runtimeRef.current?.setDirection(direction, true);
    },
    onPointerUp: () => runtimeRef.current?.setDirection(direction, false),
    onPointerLeave: () => runtimeRef.current?.setDirection(direction, false),
    onPointerCancel: () => runtimeRef.current?.setDirection(direction, false),
  });

  const padLabel =
    mode === "dance"
      ? ["왼쪽 화살표 판정", "오른쪽 화살표 판정"]
      : mode === "soccer"
        ? ["왼쪽으로 이동", "오른쪽으로 이동"]
        : ["브레이크", "가속"];

  const conditionLine =
    hud.mode === "dance"
      ? `96 BPM · ${formatClock(hud.total)}`
      : hud.mode === "soccer"
        ? `FIRST TO ${SOCCER_TARGET} · ${formatClock(hud.remaining)}`
        : `${formatMeters(hud.distance)} / ${formatMeters(DRIVE_DISTANCE)}M · HP ${hud.hp}/${DRIVE_MAX_HP}`;

  const [headLead, headEmphasis] = splitHeadline(copy.introTitle);
  const [resultLead, resultEmphasis] = splitHeadline(
    summary?.headline ?? copy.introTitle,
  );

  return (
    <>
      {/* ── M1 intro ticket ────────────────────────────────────────── */}
      <section
        className="scene scene-select scene-mode-start"
        data-mode={mode}
        hidden={scene !== "start"}
      >
        <header className="mode-ticket-header">
          <button className="text-button" type="button" onClick={onChangeMode}>
            ← 모드 선택
          </button>
          <p className="kicker">NEXT SET · {copy.label}</p>
          <p className="select-step">{copy.number} / 03</p>
        </header>

        <div className="mode-ticket">
          <div className="mode-ticket-art" data-mode={mode}>
            <Image
              src={posterUrl(character)}
              alt={`${copy.label} 세트에 나서는 캐릭터`}
              width={192}
              height={192}
              unoptimized
            />
          </div>
          <div className="mode-ticket-body">
            <p className="kicker">{copy.code}</p>
            <h1>
              {headLead}
              <br />
              <em>{headEmphasis}</em>
            </h1>
            <dl className="rule-triplet">
              <div>
                <dt>GOAL</dt>
                <dd>{copy.goal}</dd>
              </div>
              <div>
                <dt>RULE</dt>
                <dd>{copy.rule}</dd>
              </div>
              <div>
                <dt>CONTROL</dt>
                <dd>{copy.controls}</dd>
              </div>
            </dl>
            <p className="mode-control-note">
              {loadState === "error"
                ? "스프라이트를 불러오지 못했어요."
                : copy.controlNote}
            </p>
            <div className="mode-ticket-actions">
              <button
                className="primary-button"
                type="button"
                disabled={loadState === "loading"}
                onClick={startRun}
              >
                <span>
                  {loadState === "ready"
                    ? copy.start
                    : loadState === "loading"
                      ? "무대 세팅 중"
                      : "다시 불러오기"}
                </span>
                <span aria-hidden="true">→</span>
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={onChangeMode}
              >
                모드 바꾸기
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── M2 play ────────────────────────────────────────────────── */}
      <section
        className="scene scene-play scene-mode-play"
        data-mode={mode}
        hidden={scene !== "play"}
        aria-label={`${copy.label} 게임 플레이`}
      >
        <header className="play-header">
          <p className="stage-id">
            <span>{copy.number}</span>
            <strong>{copy.label}</strong>
          </p>
          <p className="mode-condition">{conditionLine}</p>
          <button
            className="icon-button"
            type="button"
            aria-label={sound ? "사운드 끄기" : "사운드 켜기"}
            onClick={onToggleSound}
          >
            {sound ? "♫" : "♪"}
          </button>
        </header>

        <div className="stage-slot" ref={stageSlotRef}>
          <div className="game-frame">
            <div className="hud-band mode-hud" data-mode={mode} aria-label="게임 상태">
              {hud.mode === "dance" && (
                <>
                  <p>
                    <small>SCORE</small>
                    <strong>{formatScore(hud.score)}</strong>
                  </p>
                  <p>
                    <small>COMBO</small>
                    <strong>{`${String(hud.combo).padStart(2, "0")} ×${hud.multiplier}`}</strong>
                  </p>
                  <p>
                    <small>SONG</small>
                    <strong>{`${formatClock(hud.elapsed)} / ${formatClock(hud.total)}`}</strong>
                  </p>
                  <div className="mode-meter">
                    <span>
                      <small>CROWD</small>
                      <strong>
                        {`${hud.crowd}%${hud.judgement ? ` · ${JUDGEMENT_COPY[hud.judgement]}` : ""}`}
                      </strong>
                    </span>
                    <div className="mode-track" aria-hidden="true">
                      <i
                        style={{ width: `${hud.crowd}%` }}
                        data-low={hud.crowd < 25}
                      />
                    </div>
                  </div>
                </>
              )}

              {hud.mode === "soccer" && (
                <>
                  <p>
                    <small>YOU</small>
                    <strong>{hud.you}</strong>
                  </p>
                  <p className="mode-spine">
                    <small>{`FIRST TO ${SOCCER_TARGET} · ${formatClock(hud.remaining)}`}</small>
                    <strong>{`${hud.you}—${hud.cpu}`}</strong>
                  </p>
                  <p>
                    <small>CPU</small>
                    <strong>{hud.cpu}</strong>
                  </p>
                </>
              )}

              {hud.mode === "drive" && (
                <>
                  <p>
                    <small>DISTANCE</small>
                    <strong>{`${formatMeters(hud.distance)} / ${formatMeters(DRIVE_DISTANCE)}M`}</strong>
                  </p>
                  <p>
                    <small>SPEED</small>
                    <strong>{hud.speed.toFixed(1).padStart(4, "0")}</strong>
                  </p>
                  <p data-danger={hud.hp <= 1}>
                    <small>HP</small>
                    <strong>{`${hearts(hud.hp)} · ${hud.hp}/${DRIVE_MAX_HP}`}</strong>
                  </p>
                  <div className="mode-meter">
                    <span>
                      <small>BOOST</small>
                      <strong>{`${hud.boost}%`}</strong>
                    </span>
                    <div className="mode-track" aria-hidden="true">
                      <i style={{ width: `${hud.boost}%` }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="canvas-wrap">
              <canvas
                ref={(node) => {
                  canvasRef.current = node;
                  if (node) runtimeRef.current?.attach(node);
                }}
                width={LOGICAL_WIDTH}
                height={LOGICAL_HEIGHT}
                aria-label={`${copy.label} 게임 화면`}
              />
              <button
                className="move-pad move-pad-left"
                type="button"
                aria-label={padLabel[0]}
                {...hold("left")}
              />
              <button
                className="move-pad move-pad-right"
                type="button"
                aria-label={padLabel[1]}
                {...hold("right")}
              />
            </div>

            <div className="portrait-cue">
              <strong>↻</strong>
              <span>
                가로로 돌리면
                <br />
                무대가 더 크게 보여요
              </span>
            </div>
          </div>
        </div>

        <div className="touch-deck" aria-label="게임 조작">
          <p className="control-hint">{copy.hint}</p>
          <button
            className="control-button jump-button"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              runtimeRef.current?.pressA();
            }}
          >
            <span className="control-key">A</span>
            <strong>{copy.aLabel}</strong>
          </button>
          <button
            className="control-button action-button"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              runtimeRef.current?.pressB();
            }}
          >
            <span className="control-key">B</span>
            <strong>{copy.bLabel}</strong>
          </button>
        </div>

        <button className="text-button quit-button" type="button" onClick={quit}>
          그만두기
        </button>
      </section>

      {/* ── M3 result ──────────────────────────────────────────────── */}
      <section
        className="scene scene-result scene-mode-result"
        data-mode={mode}
        hidden={scene !== "result"}
      >
        <header className="result-header">
          <p className="kicker">{copy.resultKicker}</p>
          <p className="result-time">
            PLAY TIME · {formatClock(summary?.seconds ?? 0)}
          </p>
        </header>

        <div className="result-pass">
          <div className="grade-stamp">
            <small>{summary?.stampLabel ?? copy.label}</small>
            <strong data-wide={(summary?.stampValue.length ?? 1) > 1}>
              {summary?.stampValue ?? "—"}
            </strong>
            <span>{summary?.stampNote ?? ""}</span>
          </div>
          <div className="result-copy">
            <h1>
              {resultLead}
              <br />
              <em>{resultEmphasis}</em>
            </h1>
            <dl className="setlist-stats">
              {(summary?.stats ?? []).map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="result-pose-wrap">
            <span className="pose-light" aria-hidden="true" />
            <Image
              src={posterUrl(character)}
              alt="선택한 캐릭터의 결과 포즈"
              width={192}
              height={192}
              unoptimized
            />
          </div>
        </div>

        <footer className="result-actions">
          <button className="primary-button" type="button" onClick={startRun}>
            <span>{copy.replay}</span>
            <span aria-hidden="true">↻</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onChangeMode}
          >
            모드 바꾸기
          </button>
          <p className="share-status">
            {summary ? `SCORE ${formatScore(summary.score)}` : ""}
          </p>
        </footer>
      </section>
    </>
  );
};

export default ModeStage;

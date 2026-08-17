"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { assetUrl } from "@/lib/site";
import { ASSET_VERSION, loadAtlas } from "@/lib/game/atlas";
import { GameRuntime, type HudSnapshot } from "@/lib/game/runtime";
import {
  CHARACTERS,
  type CharacterId,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type RunSummary,
  formatScore,
} from "@/lib/game/simulation";
import {
  getPreferences,
  getServerPreferences,
  refreshPreferences,
  subscribePreferences,
  writeBest,
  writeLastCharacter,
  writeSound,
} from "@/lib/game/storage";

type Scene = "title" | "select" | "play" | "result";
type LoadState = "loading" | "ready" | "error";

const posterUrl = (character: CharacterId) =>
  `${assetUrl(`/assets/ui-pose-${character}.png`)}?v=${ASSET_VERSION}`;

const emptyHud: HudSnapshot = {
  score: 0,
  combo: 0,
  multiplier: 1,
  fever: false,
  feverRatio: 0,
  remaining: 1,
  zoneLabel: "정글 입구",
  zoneIndex: 0,
  seconds: 0,
};

const MAX_SCALE = 4;

/**
 * Integer-only canvas scale with letterboxing (spec §8 C1). The scale is derived from
 * the *measured* stage slot rather than from viewport guesswork, so a fractional
 * scale can never sneak in when the surrounding chrome changes height.
 */
const integerScale = (width: number, height: number) =>
  Math.max(
    1,
    Math.min(
      MAX_SCALE,
      Math.floor(Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)),
    ),
  );

const GameShell = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const sceneRef = useRef<Scene>("title");
  const stageSlotRef = useRef<HTMLDivElement | null>(null);

  // sound / last runner / best score live in localStorage; the store keeps the
  // prerendered HTML and the hydrated client in sync without a mount-time setState.
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    getServerPreferences,
  );
  const { sound, character, best } = preferences;

  const [scene, setScene] = useState<Scene>("title");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [hud, setHud] = useState<HudSnapshot>(emptyHud);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [checkpoint, setCheckpoint] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [shareStatus, setShareStatus] = useState("");

  const goto = useCallback((next: Scene) => {
    sceneRef.current = next;
    setScene(next);
    setAnnouncement(
      {
        title: "타이틀",
        select: "캐릭터 선택",
        play: "게임 플레이",
        result: "결과",
      }[next],
    );
  }, []);

  /* runtime bootstrap --------------------------------------------------- */
  useEffect(() => {
    const runtime = new GameRuntime({
      onHud: setHud,
      onFinish: (result) => {
        setSummary(result);
        writeBest(result.score);
        goto("result");
      },
      onCheckpoint: () => {
        setCheckpoint(true);
        window.setTimeout(() => setCheckpoint(false), 1400);
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

    refreshPreferences();
    const stored = getPreferences();
    runtime.audio.setEnabled(stored.sound);
    runtime.drawIdle(stored.character);

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [goto]);

  /* atlas ---------------------------------------------------------------- */
  const load = useCallback(
    () =>
      loadAtlas()
        .then((atlas) => {
          runtimeRef.current?.setAtlas(atlas);
          setLoadState("ready");
        })
        .catch(() => setLoadState("error")),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /* canvas scale --------------------------------------------------------- */
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

  /* keyboard (kiosk input, spec K16) ------------------------------------- */
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "ArrowLeft") runtime.setDirection("left", true);
      if (event.code === "ArrowRight") runtime.setDirection("right", true);
      if (["Space", "ArrowUp", "KeyZ"].includes(event.code)) {
        event.preventDefault();
        runtime.pressJump();
      }
      if (
        ["KeyX", "Enter"].includes(event.code) &&
        sceneRef.current === "play"
      ) {
        event.preventDefault();
        runtime.pressAction();
      }
    };
    const up = (event: KeyboardEvent) => {
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
    setSummary(null);
    setShareStatus("");
    setHud(emptyHud);
    goto("play");
    // The canvas is only mounted in the play scene layout; start after paint.
    window.requestAnimationFrame(() => runtimeRef.current?.start(character));
  }, [character, goto]);

  const leavePlay = useCallback(
    (next: Scene) => {
      runtimeRef.current?.stop();
      runtimeRef.current?.drawIdle(character);
      goto(next);
    },
    [character, goto],
  );

  const chooseCharacter = useCallback((next: CharacterId) => {
    writeLastCharacter(next);
    runtimeRef.current?.drawIdle(next);
    setAnnouncement(`${CHARACTERS[next].name} 선택됨`);
  }, []);

  const toggleSound = useCallback(() => {
    const next = !getPreferences().sound;
    writeSound(next);
    const runtime = runtimeRef.current;
    runtime?.audio.setEnabled(next);
    if (next && sceneRef.current === "play") runtime?.audio.startMusic();
  }, []);

  const share = useCallback(async () => {
    if (!summary) return;
    const text = `LET ME LOVE YOU · ${summary.grade} GRADE · SCORE ${formatScore(summary.score)} · ${summary.characterName}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "LET ME LOVE YOU", text });
        setShareStatus("공유 화면을 열었어요.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareStatus("결과 문구를 복사했어요.");
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setShareStatus(`복사해 공유해 주세요 · ${text}`);
    }
  }, [summary]);

  const hold = (direction: "left" | "right") => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      runtimeRef.current?.setDirection(direction, true);
    },
    onPointerUp: () => runtimeRef.current?.setDirection(direction, false),
    onPointerLeave: () => runtimeRef.current?.setDirection(direction, false),
    onPointerCancel: () => runtimeRef.current?.setDirection(direction, false),
  });

  const currentCharacter = CHARACTERS[character];

  return (
    <main className="app" data-scene={scene}>
      <div className="grain" aria-hidden="true" />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* ── S1 title ─────────────────────────────────────────────── */}
      <section className="scene scene-title" hidden={scene !== "title"}>
        <header className="topline">
          <p className="kicker">FEELGOOD MUSIC PRESENTS</p>
          <button
            className="sound-toggle"
            type="button"
            aria-pressed={sound}
            onClick={toggleSound}
          >
            <span className="sound-led" data-on={sound} aria-hidden="true" />
            <span className="sound-label">
              {sound ? "사운드 켜짐" : "사운드 꺼짐"}
            </span>
          </button>
        </header>

        <div className="title-field">
          <p className="venue-code">JUNGLE / CITY / STAGE · 120 SEC</p>
          <Image
            className="wordmark"
            src={`${assetUrl("/assets/ui-logo.png")}?v=${ASSET_VERSION}`}
            alt="LET ME LOVE YOU"
            width={512}
            height={192}
            priority
            unoptimized
          />
          <p className="title-deck">
            두 개의 버튼, 세 개의 무대, 한 번의 완주.
          </p>
        </div>

        <ol className="route" aria-label="게임 진행 구간">
          <li className="route-stop route-stop-jungle">
            <span className="route-number">01</span>
            <strong>정글 입구</strong>
            <small>0—20초</small>
          </li>
          <li className="route-stop route-stop-city">
            <span className="route-number">02</span>
            <strong>도시 거리</strong>
            <small>20—70초</small>
          </li>
          <li className="route-stop route-stop-stage">
            <span className="route-number">03</span>
            <strong>무대 진입</strong>
            <small>70—110초</small>
          </li>
        </ol>

        <div className="title-action">
          <button
            className="primary-button"
            type="button"
            disabled={loadState === "loading"}
            onClick={() => {
              if (loadState === "ready") {
                goto("select");
                return;
              }
              setLoadState("loading");
              void load();
            }}
          >
            <span>
              {loadState === "ready"
                ? "무대 열기"
                : loadState === "loading"
                  ? "무대 세팅 중"
                  : "다시 불러오기"}
            </span>
            <span aria-hidden="true">↗</span>
          </button>
          <p className="load-note">
            {loadState === "ready"
              ? `100 프레임 · 사운드체크 완료${best > 0 ? ` · BEST ${formatScore(best)}` : ""}`
              : loadState === "loading"
                ? "아틀라스와 사운드체크를 준비하고 있어요."
                : "무대 에셋을 불러오지 못했어요."}
          </p>
        </div>
      </section>

      {/* ── S2 character select ──────────────────────────────────── */}
      <section className="scene scene-select" hidden={scene !== "select"}>
        <header className="select-header">
          <button
            className="text-button"
            type="button"
            onClick={() => goto("title")}
          >
            ← 타이틀로
          </button>
          <div>
            <p className="kicker">CHOOSE YOUR FLOW</p>
            <h1>오늘의 러너를 골라주세요</h1>
          </div>
          <p className="select-step">01 / 02</p>
        </header>

        <div className="character-stage">
          {(["tj", "ta"] as CharacterId[]).map((id, index) => (
            <div className="lane-slot" key={id}>
              {index === 1 && (
                <div className="selection-needle" aria-hidden="true">
                  <span>VS</span>
                </div>
              )}
              <button
                className={`character-lane lane-${id}`}
                type="button"
                aria-pressed={character === id}
                onClick={() => chooseCharacter(id)}
              >
                <span className="lane-copy">
                  <small>{CHARACTERS[id].tag}</small>
                  <strong>{CHARACTERS[id].name}</strong>
                  <span>{CHARACTERS[id].description}</span>
                </span>
                <Image
                  src={posterUrl(id)}
                  alt={`${CHARACTERS[id].name} 캐릭터`}
                  width={192}
                  height={192}
                  unoptimized
                />
                <span className="lane-meter" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </button>
            </div>
          ))}
        </div>

        <footer className="select-footer">
          <p>
            <span className="selection-dot" />
            <strong>{currentCharacter.name}</strong> 선택됨
          </p>
          <button className="primary-button" type="button" onClick={startRun}>
            <span>이 캐릭터로 달리기</span>
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>

      {/* ── S3 play ──────────────────────────────────────────────── */}
      <section
        className="scene scene-play"
        hidden={scene !== "play"}
        aria-label="게임 플레이"
      >
        <header className="play-header">
          <p className="stage-id">
            <span>{String(hud.zoneIndex + 1).padStart(2, "0")}</span>
            <strong>{hud.zoneLabel}</strong>
          </p>
          <ol className="mini-route" aria-label="현재 진행 구간">
            {["정글", "도시", "무대"].map((label, index) => (
              <li
                key={label}
                className={
                  index < hud.zoneIndex
                    ? "done"
                    : index === hud.zoneIndex
                      ? "active"
                      : ""
                }
              >
                {label}
              </li>
            ))}
          </ol>
          <button
            className="icon-button"
            type="button"
            aria-label={sound ? "사운드 끄기" : "사운드 켜기"}
            onClick={toggleSound}
          >
            {sound ? "♫" : "♪"}
          </button>
        </header>

        <div className="stage-slot" ref={stageSlotRef}>
          <div className={`game-frame${hud.fever ? "is-fever" : ""}`}>
            <div className="hud-band" aria-label="게임 상태">
              <p>
                <small>SCORE</small>
                <strong>{formatScore(hud.score)}</strong>
              </p>
              <p>
                <small>COMBO</small>
                <strong>{`${String(hud.combo).padStart(2, "0")} ×${hud.multiplier}`}</strong>
              </p>
              <div className="distance-status">
                <span>
                  <small>남은 거리</small>
                  <strong>{`${Math.round(hud.remaining * 100)}%`}</strong>
                </span>
                <div className="distance-track" aria-hidden="true">
                  <i style={{ width: `${(1 - hud.remaining) * 100}%` }} />
                  <b style={{ left: `${(1 - hud.remaining) * 100}%` }} />
                </div>
              </div>
              <div className="fever-status">
                <span>
                  <small>FEVER</small>
                  <strong>
                    {hud.fever
                      ? "ACTIVE"
                      : `${String(hud.combo).padStart(2, "0")} / 10`}
                  </strong>
                </span>
                <div className="fever-track" aria-hidden="true">
                  <i style={{ width: `${hud.feverRatio * 100}%` }} />
                </div>
              </div>
            </div>

            <div className="canvas-wrap">
              <canvas
                ref={(node) => {
                  canvasRef.current = node;
                  if (node) runtimeRef.current?.attach(node);
                }}
                width={LOGICAL_WIDTH}
                height={LOGICAL_HEIGHT}
                aria-label={`${currentCharacter.name}가 무대를 달리는 게임 화면`}
              />
              {/* Left half of the stage doubles as the move pad (spec §8 E3). */}
              <button
                className="move-pad move-pad-left"
                type="button"
                aria-label="왼쪽으로 이동"
                {...hold("left")}
              />
              <button
                className="move-pad move-pad-right"
                type="button"
                aria-label="오른쪽으로 이동"
                {...hold("right")}
              />
            </div>

            <p className="checkpoint-toast" role="status" hidden={!checkpoint}>
              BEAT BACK · 체크포인트 통과
            </p>
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
          <p className="control-hint">← → 이동 · SPACE 점프 · X 액션</p>
          <button
            className="control-button jump-button"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              runtimeRef.current?.pressJump();
            }}
          >
            <span className="control-key">A</span>
            <strong>점프</strong>
          </button>
          <button
            className="control-button action-button"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              runtimeRef.current?.pressAction();
            }}
          >
            <span className="control-key">B</span>
            <strong>액션</strong>
          </button>
        </div>

        <button
          className="text-button quit-button"
          type="button"
          onClick={() => leavePlay("title")}
        >
          그만두기
        </button>
      </section>

      {/* ── S4 result ────────────────────────────────────────────── */}
      <section className="scene scene-result" hidden={scene !== "result"}>
        <header className="result-header">
          <p className="kicker">FEELGOOD MUSIC · SHOW RECEIPT</p>
          <p className="result-time">
            PLAY TIME · 01:
            {String(summary ? summary.seconds % 60 : 50).padStart(2, "0")}
          </p>
        </header>

        <div className="result-pass">
          <div className="grade-stamp">
            <small>GRADE</small>
            <strong>{summary?.grade ?? "C"}</strong>
            <span>{summary?.complete ? "SHOW COMPLETE" : "SHOW PARTIAL"}</span>
          </div>
          <div className="result-copy">
            <h1>
              {summary?.style.split(" ").slice(0, -2).join(" ") ||
                "끝까지 달린"}
              <br />
              <em>
                {summary?.style.split(" ").slice(-2).join(" ") ||
                  "ROOKIE RUNNER"}
              </em>
            </h1>
            <dl className="setlist-stats">
              <div>
                <dt>SCORE</dt>
                <dd>{formatScore(summary?.score ?? 0)}</dd>
              </div>
              <div>
                <dt>MAX COMBO</dt>
                <dd>{summary?.maxCombo ?? 0}</dd>
              </div>
              <div>
                <dt>FEVER</dt>
                <dd>{summary?.feverCount ?? 0}</dd>
              </div>
              <div>
                <dt>RUNNER</dt>
                <dd>{summary?.characterName ?? currentCharacter.name}</dd>
              </div>
            </dl>
          </div>
          <div className="result-pose-wrap">
            <span className="pose-light" aria-hidden="true" />
            <Image
              src={posterUrl(summary?.character ?? character)}
              alt="선택한 캐릭터의 결과 포즈"
              width={192}
              height={192}
              unoptimized
            />
          </div>
          <div className="qr-note">
            <span className="qr-mark" aria-hidden="true" />
            <p>
              <strong>현장 QR</strong>
              <br />
              결과를 가져가세요
            </p>
          </div>
        </div>

        <footer className="result-actions">
          <button className="primary-button" type="button" onClick={startRun}>
            <span>한 번 더</span>
            <span aria-hidden="true">↻</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => goto("select")}
          >
            캐릭터 변경
          </button>
          <button className="secondary-button" type="button" onClick={share}>
            결과 공유
          </button>
          <p className="share-status" aria-live="polite">
            {shareStatus || (best > 0 ? `BEST ${formatScore(best)}` : "")}
          </p>
        </footer>
      </section>
    </main>
  );
};

export default GameShell;

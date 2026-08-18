import type { ModeId } from "./mode-simulation";

/**
 * UI copy for the three mode sets (`design/screens.json` → mode-entry and the
 * three `*-start` screens). Rules and numbers live in `./mode-simulation`; this
 * file only names them for the shell.
 */
export type ModeCopy = {
  id: ModeId;
  number: string;
  label: string;
  /** Setlist stop caption on the title screen. */
  tagline: string;
  /** Verb on the title action that opens the intro ticket. */
  entry: string;
  code: string;
  /** `"lead|emphasis"` — the intro headline is split on the pipe. */
  introTitle: string;
  goal: string;
  rule: string;
  controls: string;
  controlNote: string;
  /** Verb that starts the actual run. */
  start: string;
  hint: string;
  aLabel: string;
  bLabel: string;
  replay: string;
  resultKicker: string;
};

export const MODE_COPY: Record<ModeId, ModeCopy> = {
  dance: {
    id: "dance",
    number: "01",
    label: "DANCE",
    tagline: "96 BPM",
    entry: "비트 체크",
    code: "DANCE · BEAT CHECK",
    introTitle: "비트가 닿는 순간|몸으로 답하세요",
    goal: "96 BPM 완주",
    rule: "PERFECT ±5 · GOOD ±12",
    controls: "← → SHAKE · A=UP · B=DOWN",
    controlNote: "무대 왼쪽/오른쪽 = SHAKE · A = HANDS UP · B = DROP",
    start: "춤 시작",
    hint: "← → SHAKE · A HANDS UP · B DROP",
    aLabel: "HANDS UP",
    bLabel: "DROP",
    replay: "다시 춤추기",
    resultKicker: "DANCE · FINAL TAKE",
  },
  soccer: {
    id: "soccer",
    number: "02",
    label: "SOCCER",
    tagline: "FIRST TO 5",
    entry: "킥오프 준비",
    code: "SOCCER · KICKOFF",
    introTitle: "공은 하나|골대는 두 개",
    goal: "FIRST TO 5",
    rule: "5선취 또는 100 SEC",
    controls: "← → 이동 · A=점프 · B=킥",
    controlNote: "몸으로 막으면 세이브 · 점프와 킥으로 먼저 5골",
    start: "킥오프",
    hint: "← → 이동 · A 점프 · B 킥",
    aLabel: "점프",
    bLabel: "킥",
    replay: "재경기",
    resultKicker: "SOCCER · FINAL SCORE",
  },
  drive: {
    id: "drive",
    number: "03",
    label: "DRIVE",
    tagline: "4,000M",
    entry: "시동 걸기",
    code: "DRIVE · SUNSET RUN",
    introTitle: "석양이 지기 전에|집으로 달리세요",
    goal: "4,000M 도달",
    rule: "HP 3 · BOOST 100",
    controls: "→ 가속 · ← 브레이크 · A=점프 · B=사격",
    controlNote: "A 더블 점프 · B 전방 사격 · 하트로 부스트를 채우기",
    start: "출발",
    hint: "→ 가속 · ← 브레이크 · A 점프 · B 사격",
    aLabel: "점프",
    bLabel: "사격",
    replay: "다시 달리기",
    resultKicker: "DRIVE · TRIP RECEIPT",
  },
};

export const MODE_ORDER: ModeId[] = ["dance", "soccer", "drive"];

/** `"lead|emphasis"` → the two lines every mode headline renders as. */
export const splitHeadline = (value: string): [string, string] => {
  const [lead, emphasis] = value.split("|");
  return [lead ?? "", emphasis ?? ""];
};

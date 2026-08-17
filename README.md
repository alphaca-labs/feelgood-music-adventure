# LET ME LOVE YOU — 필굿뮤직 어드벤처

정글 → 도시 → 무대 세 구간을 110초 동안 달리는 2D 도트 러너입니다. Next.js 정적 export + 단일
`<canvas>`(320×180 논리 해상도)로 만들어졌고, GitHub Pages에 배포됩니다.

**플레이:** <https://alphaca-labs.github.io/feelgood-music-adventure/>

## 게임 구성

| 씬          | 내용                                                           |
| ----------- | -------------------------------------------------------------- |
| 타이틀      | 로고 · 구간 안내 · 사운드 온/오프                              |
| 캐릭터 선택 | 타이거 JK(POWER RUN) / 윤미래(LIGHT JUMP)                      |
| 플레이      | 3구간(20초 / 50초 / 35초) + 마무리 대형 장애물 회피 5초        |
| 결과        | 점수 · 등급(S/A/B/C) · 최대 콤보 · 피버 횟수 · 다시하기 · 공유 |

- **조작 2버튼**: 점프(더블 점프 포함) · 액션(짧은 공격). 캔버스 좌·우 절반은 이동 패드입니다.
  키보드는 `←/→` 이동, `Space`·`↑`·`Z` 점프, `X`·`Enter` 액션.
- **게임오버 없음**: 실패하면 짧게 되돌아갈 뿐이며 마지막 체크포인트보다 뒤로는 밀리지 않습니다.
- **콤보 · 피버**: 2초 안에 이어 먹으면 콤보가 쌓이고 콤보 10에서 5초간 피버(무적 + 점수 1.5배).
- **저장**: `localStorage` 3키(`fma.v1.sound` / `fma.v1.best` / `fma.v1.lastChar`)만 사용합니다.
  서버·쿠키·외부 전송은 없습니다.

## 구조

```
apps/web/
  app/                     # 단일 라우트 + 정적 export 설정
  components/game/         # 4씬 UI 셸
  lib/game/
    simulation.ts          # 순수 게임 규칙 (DOM 의존 0, Node에서도 실행됨)
    renderer.ts            # 아틀라스 기반 canvas 렌더러
    runtime.ts             # rAF 루프 · 입력 · 오디오 연결
    audio.ts               # 절차 생성 사운드 (오디오 파일 0바이트)
    atlas.ts, storage.ts
  public/assets/           # atlas-game.png/json (100 프레임) + UI 이미지
scripts/smoke-game.mjs     # 시뮬레이션 + 번들 + 헤드리스 브라우저 스모크
.github/workflows/deploy-pages.yml
```

`apps/admin`·`apps/email`·`packages/*`는 omniseed 템플릿에서 이어받은 구성이며 게임 배포 대상은
`apps/web` 하나입니다.

## 개발

```bash
pnpm install
pnpm web            # http://localhost:3000
pnpm --filter web build   # apps/web/out 정적 export
pnpm smoke          # 빌드 + 스모크 (약 40초)
pnpm smoke -- --full      # 110초 한 판을 끝까지 플레이해 결과 화면까지 검증
pnpm build          # 전체 turbo build
pnpm typecheck
pnpm lint
```

### 배포

`main`에 push되면 `deploy-pages` 워크플로가 `NEXT_PUBLIC_BASE_PATH=/feelgood-music-adventure`로
정적 export를 만들고 GitHub Pages에 올립니다. 저장소 Settings → Pages의 소스는 **GitHub Actions**여야
합니다.

- `basePath`는 Next 라우팅에만 적용되므로 런타임에서 아틀라스를 직접 `fetch` 할 때 쓰는 값은
  `apps/web/lib/site.ts`가 같은 환경변수에서 다시 만듭니다. 이 한 줄이 빠지면 로컬은 통과하고
  Pages에서만 404가 납니다.
- `apps/web/public/.nojekyll`이 없으면 Pages가 `_next/` 디렉터리를 통째로 무시해 흰 화면이 됩니다.
- 에셋 캐시는 `apps/web/lib/game/atlas.ts`의 `ASSET_VERSION` 쿼리로 무효화합니다(Pages는
  `Cache-Control`을 지정할 수 없습니다).

## 에셋

`apps/web/public/assets/atlas-game.png`(512×512, PNG-8 16색, 20,426 B)와 `atlas-game.json`(100 프레임)
한 쌍이 게임의 모든 스프라이트입니다. 이미지 자산 합계는 56,831 B이고 이미지 디코드는 세션당 1회입니다.
아틀라스는 생성 스크립트 없이도 그대로 성립하는 최종 산출물이라 저장소에 그대로 커밋합니다.

## 라이선스

사내 프로젝트입니다.

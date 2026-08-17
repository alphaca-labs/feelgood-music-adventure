# Omniseed

Turborepo 기반의 풀스택 모노레포 프로젝트입니다. pnpm 워크스페이스와 Turbo를 활용해 여러 애플리케이션과 공유 패키지를 한 곳에서 관리합니다.

## 개요

Omniseed는 웹(`web`)·어드민(`admin`) 애플리케이션과 Fastify API(`api`), React Router v7 프론트엔드(`frontend`)를 중심으로, 디자인 시스템·데이터베이스·API 클라이언트 등 재사용 가능한 패키지를 함께 제공하는 모노레포 보일러플레이트입니다.

- **모노레포 도구**: Turbo + pnpm workspaces
- **언어 / 런타임**: TypeScript, Node.js ≥ 24
- **프론트엔드**: Next.js (`web`/`admin`), React Router v7 (`frontend`)
- **백엔드 API**: Fastify v5 (`api`, tRPC + REST 하이브리드)
- **DB / ORM**: Prisma (`packages/database`)
- **UI**: Tailwind CSS v4, shadcn 기반 디자인 시스템
- **API 클라이언트 생성**: Orval
- **템플릿 프루닝**: Bootstrap 스크립트(flavor별 초기 구성)
- **코드 품질**: ESLint 9, Prettier

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 패키지 매니저 | pnpm 10.26.0 |
| 빌드 오케스트레이션 | Turbo 2.x |
| 프론트엔드 | Next.js (web/admin, eslint-config-next 16), React Router v7 (frontend, Vite + SSR), React 19 |
| 백엔드 API | Fastify v5 (CommonJS, tsup 빌드, tRPC + REST 하이브리드) |
| 스타일링 | Tailwind CSS 4, prettier-plugin-tailwindcss |
| 데이터베이스 | Prisma 7 (하이브리드 클라이언트) |
| 번들러 | tsup 8 |
| 자동화 | Auto (릴리스/체인지로그) |

## 사전 요구사항

- Node.js **24 이상**
- pnpm **10.26.0** (`corepack enable` 후 자동 설치 권장)
- (옵션) Prisma 사용 시 환경 변수 `DATABASE_URL` 설정

## 설치

```bash
# 저장소 클론
git clone https://github.com/alphaca-labs/omniseed.git
cd omniseed

# 의존성 설치
pnpm install
```

## 사용법

### 개발 서버 실행

```bash
# 전체 앱 동시 실행
pnpm dev

# 개별 앱 실행
pnpm web        # apps/web        (port 3000, Next.js)
pnpm admin      # apps/admin      (port 3001, Next.js)
pnpm frontend   # apps/frontend   (port 3003, React Router v7)
```

> `apps/api`(Fastify v5, port **3002**)는 `pnpm dev`로 함께 기동됩니다. `apps/frontend`는 `@repo` 의존성 없이 API와 HTTP로 통신하는 자체 완결형 앱입니다.

### 빌드 / 린트

```bash
pnpm build         # 전체 빌드 (turbo build)
pnpm lint          # ESLint 검사
pnpm format        # Prettier 적용
pnpm format:check  # 포맷팅 검증
pnpm analyze       # 번들 분석
```

### 데이터베이스 (Prisma)

```bash
pnpm migrate   # prisma format + generate + db push
pnpm studio    # Prisma Studio 실행
```

DB 접근은 소비자 환경에 따라 진입점이 다릅니다.

- `import { database } from '@repo/database'` — Next.js RSC 전용(server-only).
- `import { database } from '@repo/database/node'` — 일반 Node 소비자(Fastify api·CLI·워커)용. Prisma 7 하이브리드 클라이언트이므로 번들링이 필요합니다.

### API 클라이언트 코드 생성 (Orval)

```bash
pnpm gen:api-web     # apps/web 용 API 클라이언트 생성
pnpm gen:api-admin   # apps/admin 용 API 클라이언트 생성
```

### 기타 유틸리티

```bash
pnpm bump-deps   # 의존성 일괄 업데이트 (react-day-picker 제외)
pnpm bump-ui     # shadcn UI 컴포넌트 전체 업데이트
pnpm clean       # node_modules 초기화
```

## Bootstrap (템플릿 초기 구성)

이 템플릿은 모든 flavor를 포함한 상태로 배포됩니다. 프로젝트 시작 시 bootstrap 스크립트로 불필요한 앱/패키지를 프루닝해 원하는 구성만 남길 수 있습니다.

| 명령 | Flavor | 동작 |
| --- | --- | --- |
| `pnpm bootstrap` | Next 풀스택 | `apps/api`·`apps/storybook`·`apps/frontend` 삭제 |
| `pnpm bootstrap:front` | 프론트엔드 단독(RR7) | `packages/database`를 포함한 나머지 전부 삭제, `design-system` + 전이 의존성만 유지 |
| `pnpm bootstrap:separate` | frontend + api(Fastify) | `apps/web`·`apps/admin`·`apps/storybook` 삭제 |

> ⚠️ **파괴적 작업**: 디렉터리를 실제로 삭제합니다. 안전장치로 `--dry-run`(미리보기) / `--yes`(확인 생략) / `--force` 옵션과 git-dirty 가드를 제공합니다. 실행 후 스크립트는 자기 자신을 제거합니다.

## 프로젝트 구조

```
omniseed/
├── apps/                  # 실행 가능한 애플리케이션
│   ├── web/               # 사용자용 웹 앱 (Next.js, port 3000)
│   ├── admin/             # 어드민 앱 (Next.js, port 3001)
│   ├── api/               # 백엔드 API (Fastify v5, port 3002)
│   ├── frontend/          # 프론트엔드 앱 (React Router v7, port 3003)
│   ├── email/             # 이메일 템플릿 (React Email)
│   └── storybook/         # 컴포넌트 문서 (port 6006)
├── packages/              # 공유 패키지 (워크스페이스)
│   ├── database/          # Prisma 스키마 및 클라이언트
│   ├── design-system/     # shadcn 기반 UI 컴포넌트
│   └── ...                # typescript-config 등 공통 설정
├── turbo/                 # Turbo 제너레이터 템플릿
├── turbo.json             # Turbo 파이프라인 설정
├── pnpm-workspace.yaml    # 워크스페이스 정의
├── tsconfig.json          # 루트 TS 설정
├── tsup.config.ts         # 라이브러리 번들 설정
├── eslint.config.mjs      # ESLint 플랫 설정
├── .prettierrc            # Prettier 설정
└── package.json           # 루트 스크립트 및 의존성
```

## 워크스페이스 규칙

- 공통 TypeScript 설정은 `@repo/typescript-config` 워크스페이스 패키지를 참조합니다.
- React 타입 버전은 `pnpm.overrides`로 `@types/react@19.2.7`, `@types/react-dom@19.2.3` 고정.
- 일부 네이티브 빌드 의존성(`@prisma/engines`, `@swc/core`, `esbuild`, `sharp` 등)은 `ignoredBuiltDependencies`로 빌드 스킵 처리되어 있습니다.

## 기여

1. 새 브랜치 생성 후 작업
2. `pnpm lint && pnpm format:check` 통과 확인
3. PR 생성 — Auto 기반 변경 이력/릴리스 자동화가 적용됩니다.

## 라이선스

저장소 루트의 라이선스 파일을 참고하세요.

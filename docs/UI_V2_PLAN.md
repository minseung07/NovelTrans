# NovelTrans 프론트엔드 v2 — 전체 계획 & Phase별 TODO

옛 TUI(`src/ui/`, `terminalApp.ts` 1640줄 God class + 11개 "방" 구조)를 폐기하고,
이 앱의 본질(① 길고 재개 가능한 비동기 배치 번역 ② 사람이 개입하는 용어/QA 큐레이션
③ 가져오기→번역→용어집→QA→내보내기 파이프라인)에 맞춰 `src/ui-v2/`를 새로 짠다.

`docs/UI_UX_PLANS.md`는 폐기·방치하며 본 문서가 단일 기준이다.

---

## 0. 확정 결정 (변경 시 본 문서부터 갱신)

- **레이아웃:** 좌측 **단계 레일** + 우측 **상세 패널**. 좁은 폭(<폭 임계)에선 상단 번호 스트립으로 접힘.
- **전역 Job 모델 도입:** 번역/재시도/내보내기/웹가져오기를 1급 `Job`으로. 화면을 떠나도 진행률 유지.
- **전환:** 구현 동안 `app --v2` / `NOVELTRANS_UI=v2`로 옛 UI와 병존. 패리티 도달 후 기본값을 v2로 뒤집고 `src/ui/` 제거.

### 불변 제약 (절대 위반 금지)

- 런타임 의존성 **0개**. 순수 Node + ESM(NodeNext, ES2022, `strict`, `noUncheckedIndexedAccess`).
- `bin → dist/index.js`, 커밋된 `dist/` 그대로 배포 → 번들러/무거운 의존성 금지.
- `view`는 **순수 함수**(model → string[]) 유지 → `node --test` 스냅샷 보존.
- CJK 폭 로직(`layout.ts`의 `charCellWidth` 등) 회귀 금지.

### 목표 / 비목표

- 목표: 상태 주도 UX, 전역 잡 가시성, 용어/QA 초고속 트리아지, MVU로 유지보수성 확보.
- 비목표: 백엔드 로직 변경, 새 번역 기능, 도메인 모델 재설계. (UI 레이어만 교체)

---

## 1. 정보 구조 (11개 방 → 2화면 + 레일 + 오버레이)

**최상위 화면 2개**

- **Library** — 프로젝트 목록(파이프라인 진행률 게이지 + "이어하기" 강조), 즉시 검색 필터, 새 작품 가져오기.
- **Project Workspace** — 좌측 단계 레일 + 우측 상세. 풀스크린 전환 없이 단계만 교체.

**Project 단계 레일 (배지로 상태 한눈에)**

| 단계 | 내용 | 배지 예 |
|---|---|---|
| Overview | 파이프라인 상태 · 다음 할 일 · 라이브 잡 · 최근 활동 | — |
| Source | 원문/화 분할/원문 통계 | 42화 |
| Translate | 잡 제어(실행/이어가기/재시도) · 라이브 진행 · 화별 상태 · **실패 화 인라인** | ●2 실패 |
| Glossary | 검토 큐(후보/충돌/잠금/금칙) | ●12 후보 |
| QA | 유형별 이슈 · 원문/번역 대조 | ●3 이슈 |
| Export | 포맷·옵션·미리보기·생성 | — |

- 옛 **failure-recovery** → Translate 단계로 흡수(실패는 정상 흐름).
- 옛 **search** → Library 즉시 필터로 흡수. **settings**는 전역(팔레트/Library 진입).

**오버레이(풀스크린 아님):** Command Palette(`Ctrl+K`/`:`, 퍼지), Help(`?`), 확인/입력/피커 Modal(중앙 오버레이), Toast(자동 소멸).

**지속 크롬:** 상단 Breadcrumb(`Library › 작품 › 단계`), 하단 StatusBar(백엔드·모델·동시성·**전역 잡 진행률**·시계 + 문맥 키힌트).

**내비/입력 일관 규칙:** `↑↓`·`j/k` 이동, `Enter` 실행, `Esc`·`b` 뒤로, `Tab` 패널 포커스 순환, 숫자키 단계 점프, `Ctrl+K`/`:` 팔레트, `?` 도움말.

---

## 2. 아키텍처 (진짜 MVU)

```text
src/ui-v2/
  runtime/        # TUI 엔진 (의존성 0)
    terminal.ts     raw mode / alt screen / resize(SIGWINCH) / cursor
    renderer.ts     diff 렌더러            (기존 src/ui/core/renderer.ts 포팅)
    input.ts        bytes → 시맨틱 KeyEvent (legacy 변환 제거)
    loop.ts         dispatch + effects + timers/subscriptions
  theme/            theme / ansi / capabilities  (기존 src/ui/core/* 포팅)
  components/       순수: props → string[]
                    box panel list table split rail tabs progress spinner
                    badge statusbar breadcrumb modal toast palette help keyhint
  state/
    model.ts  msg.ts  update.ts  effects.ts  keymap.ts
  data/             백엔드 위 셀렉터 (기존 studioData/nextActions/glossaryQueue 재사용)
  screens/          순수 view: library, project/{overview,source,translate,
                    glossary,qa,export}
  app.ts            runUiV2(options) — runtime+state+view 결선
```

```ts
// MVU 계약
function update(model: Model, msg: Msg): [Model, Cmd[]];  // 순수
function view(model: Model): string[];                     // 순수 (스냅샷 테스트)
// loop: KeyEvent | JobEvent | Tick → update → view → diff render
//       Cmd[]는 effects가 백엔드 서비스 호출 후 결과를 Msg로 재투입
```

### Model 스케치 (state/model.ts)

```ts
type Route = { screen: "library" } | { screen: "project"; stage: Stage };
type Stage = "overview" | "source" | "translate" | "glossary" | "qa" | "export";
type Job = { kind: "translate"|"retry"|"export"|"web-import"; progress: number;
             status: "running"|"paused"|"done"|"failed"; label: string };
type Overlay = null | { kind: "palette"|"help"|"confirm"|"input"|"picker"; ... };
interface Model {
  route: Route; projectDir?: string;
  library: { items: ...; query: string; selected: number };
  project?: { model: ProjectUiModel; selections: Record<Stage, number>; ... };
  job: Job | null;            // 전역 1개(전경) — 화면 무관 지속
  overlay: Overlay; toast: Toast | null;
  viewport: { cols: number; rows: number }; theme: ThemeState;
}
```

### 재사용 / 폐기 경계

- **재사용:** 백엔드 전부(`engine/storage/glossary/qa/export/config/webImport/domain`),
  데이터 셀렉터(`studioData`·`nextActions`·`glossaryQueue`·`reviewDeskModel`),
  `core/renderer`·`input`·`theme`·`capabilities`·`ansi`·`geometry`, `layout.ts` 폭 로직.
- **폐기:** `terminalApp.ts` God class, "방" 전환 모델, `decodeToLegacyKeys` 경유, 옛 screens/widgets.

---

## 3. 두 병목의 트리아지 루프 (UX 투자 집중)

- **Glossary (inbox-zero식):** 한 번에 한 항목 — 원어·제안 번역·등장 횟수/문맥·신뢰도 막대·충돌 경고.
  단축키 `c` 확정 · `l` 잠금 · `f` 금칙 · `e` 편집 · `d` 보류 · `j/k` 이동, "N 남음" 표시.
- **QA:** 유형별 색 분류(잔류 일본어/숫자 불일치/길이비/용어 일관성), 우측 원문 vs 번역 대조.
  액션: 무시 · 해당 화 재번역 · (용어 일관성이면) Glossary 점프.

---

## 4. 테스트 전략

- `view`/`components` 순수 함수 골든 스냅샷(`node --test dist/**/*.test.js`).
- `runtime/input` 바이트 시퀀스 디코딩 테스트, `state/update` 전이 테스트, `keymap` 충돌 정적 검증.
- 능력 강등표(truecolor→256→16→무색), CJK 폭 회귀 테스트.
- 각 Phase 게이트: `npm run build` + `npm test` + `npm run smoke` 통과.

---

## 5. Phase별 계획 & TODO

각 Phase는 독립적으로 빌드/테스트/스모크 통과를 게이트로 둔다.

### Phase 0 — runtime + theme 토대
- 목표: 빈 화면이 diff 렌더 · 시맨틱 입력 · 테마 색으로 뜨고 스모크 통과.
- TODO
  - [x] `src/ui-v2/` 스캐폴딩 + `app.ts`의 `runUiV2()` 스텁
  - [x] `theme/{ansi,capabilities,theme}.ts` 포팅(기존 `core/*` 기반)
  - [x] `runtime/renderer.ts` diff 렌더러 포팅 + `invalidate()`(리사이즈 전체 재그리기)
  - [x] `runtime/input.ts` bytes→`KeyEvent`(CSI/SS3/bracketed-paste/ESC 타임아웃, legacy 제거)
  - [x] `runtime/terminal.ts` raw mode/alt screen/cursor 숨김·복원/SIGWINCH
  - [x] `runtime/loop.ts` 최소 MVU 루프(dispatch→view→render), `Esc`로 종료
  - [x] `cli/commands.ts` `app --v2`/`NOVELTRANS_UI=v2` 분기로 `runUiV2()` 연결(옛 UI 병존)
  - [x] 테스트: input 디코드, 능력 강등표, 렌더러 골든 프레임
- 게이트: build/test/smoke + `app --v2`로 빈 셸 표시 후 정상 종료.

### Phase 1 — components + Library 화면
- 목표: 프로젝트 목록 탐색/검색/생성 진입까지 동작.
- TODO
  - [x] `components/`: box, panel, list(selectionRow), badge, progress, statusbar, breadcrumb, spinner
  - [x] `geometry`로 split/stack/scroll(visibleWindow) 정리
  - [x] `data/library.ts` 셀렉터(기존 `studioData.loadBookshelfModel` 활용)
  - [x] `screens/library.ts` 순수 view(카드/진행 게이지 + "이어하기" 강조)
  - [x] `state/keymap.ts` 데이터 기반 + Library 바인딩, `keymapConflicts()` 검증
  - [x] Library 즉시 검색 필터(옛 search 흡수)
  - [x] 새 작품 가져오기 진입점(모달/입력 — 실제 import는 Phase 5에서 완성)
  - [x] 테스트: library view 스냅샷, keymap 충돌 0
- 게이트: build/test/smoke + Library에서 프로젝트 선택→Project 셸 진입.

### Phase 2 — Project 셸 + Overview + 전역 Job 모델
- 목표: 단계 레일 골격 + Overview, 번역 잡이 화면 무관하게 StatusBar에 지속.
- TODO
  - [x] `components/`: rail(+narrow 탭 폴백), tabs, statusbar 잡 진행률 슬롯
  - [x] `state/model.ts` 라우트/단계/선택/`job` 필드, `update.ts` 네비게이션 전이
  - [x] `state/effects.ts` 잡 실행기: `Job` 시작/진행 이벤트→Msg 재투입(translate 우선)
  - [x] `data/project.ts` 셀렉터(기존 `loadProjectUiModel`·`nextActions` 활용)
  - [x] `screens/project/overview.ts`(파이프라인 상태·다음 할 일·라이브 잡·최근 활동)
  - [x] Breadcrumb `Library › 작품 › 단계`, 단계 숫자키 점프
  - [x] 테스트: overview 스냅샷, update 네비/잡 전이, 잡 진행 중 statusbar 표기
- 게이트: build/test/smoke + 번역 시작 후 다른 단계로 이동해도 진행률 지속.

### Phase 3 — Glossary · QA 트리아지 루프
- 목표: 두 병목을 단축키 기반 고속 처리.
- TODO
  - [x] `screens/project/glossary.ts` 큐 view(후보/충돌/잠금/금칙, 신뢰도 막대, "N 남음")
  - [x] glossary 단축키 `c/l/f/e/d/j/k` → effects(`confirmGlossaryTerm`/`addForbiddenTarget`/`deprecateGlossaryTerm`) + 로그
  - [x] `data/` 재사용: `glossaryQueue` 빌더, 충돌 셀렉터
  - [x] `screens/project/qa.ts` 유형별 색 분류 + 우측 원문/번역 대조 view
  - [x] qa 액션: 무시(`updateQAIssue`)·해당 화 재번역(잡)·용어 일관성→glossary 점프
  - [x] components: table/split(대조 뷰), modal(편집·확인)
  - [x] 테스트: glossary/qa view 스냅샷, 단축키 update 전이
- 게이트: build/test/smoke + 후보 확정/금칙·QA 무시/재번역 왕복.

### Phase 4 — Translate · Export · Settings · Palette · Help
- 목표: 나머지 단계/오버레이 완성으로 기능 패리티 근접.
- TODO
  - [x] `screens/project/translate.ts`: 잡 제어(실행/이어가기/재시도/일시정지) + 화별 상태 + **실패 인라인**(옛 failure-recovery 흡수, skip-and-export 포함)
  - [x] `screens/project/export.ts`: 포맷/옵션 토글 + 미리보기 + 생성 잡
  - [x] Settings 전역 오버레이: 백엔드/모델 프리셋/동시성/스타일/QA/출력/ API키(마스킹)
  - [x] Command Palette(퍼지 매칭+하이라이트, 확인 필요 명령 색 구분) — 기존 `commands`/`paletteExecution` 연계
  - [x] Help 오버레이(키맵에서 자동 생성), Toast 자동 소멸, 확인 Modal 일원화
  - [x] import 플로우 완성(txt/stdin/inline/web; web는 `--confirm-rights` 가드 유지)
  - [x] 테스트: 각 화면 스냅샷, 팔레트 필터, settings 전이
- 게이트: build/test/smoke + 가져오기→번역→용어→QA→내보내기 e2e(dry-run).

### Phase 5 — 전환 · 폴백 · 정리
- 목표: v2를 기본으로, 옛 UI 제거, 접근성/문서 마감.
- TODO
  - [x] 비-TTY 1회 정적 출력, `NO_COLOR`/`TERM=dumb` ASCII 폴백, 좁은 폭 스택 검증
  - [x] CLI 정적 서브커맨드(`studio`/`glossary-lab`/`review-desk`/`export-room`/`bookshelf`/`palette`) 출력을 v2 view로 재배선
  - [x] `app` 기본값 v2로 전환, `--v2`/env 게이트 제거
  - [x] 옛 `src/ui/`(인터랙티브 TUI: terminalApp/screens/widgets/core/app/keyHandlers/layout 등) 및 관련 테스트 제거, import 정리, `dist/` 재빌드. (모델/액션 빌더 계층은 v2가 재사용하므로 `src/ui/`에 잔존)
  - [x] README/CHANGELOG 갱신(`UI_UX_PLANS.md`는 폐기 명시)
  - [x] 회귀: 전체 test + smoke + 수동 점검
- 게이트: 옛 UI 의존 0건, 전체 test/smoke 통과, 패키지 내용 확인(`npm pack --dry-run`).

---

## 6. 리스크 & 방어

- diff 렌더러 경계버그(리사이즈/높이초과) → 골든 프레임 테스트 + `invalidate()` 전체 재그리기.
- ESC 타임아웃(느린 SSH 화살표 오인식) → 임계값 상수화 + 테스트.
- CJK 폭 회귀 → 기존 폭 로직 그대로 포팅 + 폭 테스트 보강.
- 잡 동시성: 프로젝트당 전경 잡 1개 가정. 그 이상은 비목표(향후 과제).
- 패리티 누락 → Phase 5 e2e 체크리스트로 옛 명령 대비 기능 매핑 확인.

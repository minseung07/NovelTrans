# NovelTrans 프론트엔드 재작성 플랜

이 문서는 NovelTrans 터미널 UI(TUI)를 **사실상 새로 짜는** 계획이다.
이전 wizard/Studio 기획 문서는 폐기하고, "투박함"의 근본 원인을 구조적으로
제거하는 데 초점을 둔다.

여기서 "프론트엔드"는 두 표면을 의미한다.

1. 풀스크린 인터랙티브 TUI (`noveltrans app`) — `src/ui/`
2. 명령형 서브커맨드(`translate`, `status`, `glossary` 등) — `src/cli/`

재작성의 주 대상은 TUI다.

---

## 0. 불변 제약 (반드시 유지)

재작성은 다음 제약을 깨지 않는다. 이 제약들이 기술 결정의 토대다.

- **런타임 의존성 0개.** 현재 `devDependencies`만 존재(`typescript`, `@types/node`).
  순수 Node + ESM(NodeNext, ES2022, `strict`, `noUncheckedIndexedAccess`).
- **설치 모델.** `bin → dist/index.js`, 커밋된 `dist/`를 그대로 배포한다.
  GitHub 설치 시 빌드를 돌리지 않는다 → 무거운 의존성/번들러 도입은 이 모델을 깨뜨린다.
- **테스트 자산.** Node 내장 러너(`node --test dist/**/*.test.js`).
  화면을 순수 함수로 스냅샷 테스트(`uiScreens.test.ts`) 중 → 이 방식은 보존한다.

---

## 1. 무엇이 "투박함"인가 — 해결 목표

| 현재 문제 | 근본 원인 | 목표 상태 |
|---|---|---|
| 밋밋함 | ANSI 색상/스타일 0개, ASCII `+--+` 박스 | 테마 기반 색상 + 유니코드 박스(+ASCII 폴백) |
| 깜빡임 | 매 프레임 `ESC[2J` 전체 클리어 후 재출력 | 더블버퍼 diff 렌더링(바뀐 줄만 갱신) |
| 입력 끊김/오작동 | 청크=키 가정, ESC 시퀀스 정확매칭, 다중키 유실 | 입력 디코더 상태머신(ESC 타임아웃, paste, 다중키) |
| 유지보수난 | `terminalApp.ts` 1626줄 God class, if-체인 디스패치 | MVU 런타임 + 공간별 reducer + 중앙 키맵 |
| 정보 위계 빈약 | 텍스트 라벨로만 긴급/주의 구분 | 색·뱃지·아이콘으로 위계 표현 |

**핵심 설계 원칙**

- 메뉴가 아니라 상태를 보여준다. 앱이 다음 행동을 제안한다.
- 실패를 정상 흐름으로 다룬다(복구 화면).
- 용어집은 어디서든 가깝게 둔다.
- `view`는 순수 함수로 유지한다(테스트 가능성).

---

## 2. 핵심 기술 결정: 자체 TUI 코어 (Ink 미채택)

- **Option A — Ink(React for CLI):** flexbox·diff 렌더링·컴포넌트를 공짜로 얻지만
  React + reconciler 등 런타임 의존성 수십 개가 붙어 "커밋된 dist + 무빌드 설치"
  모델이 깨지고(번들러 필요), CJK 폭 제어를 라이브러리에 위임하게 된다.
- **Option B(채택) — 자체 TUI 코어:** 기존 "render = 순수 함수" 구조가 이미 좋은 토대다.
  필요한 것은 그 아래 깔 **렌더 코어 / 입력 / 테마** 세 레이어뿐이다. 의존성 0개를
  유지하고, 이미 정교한 CJK 폭 로직(`layout.ts`)도 그대로 살린다.

→ **자체 코어로 재작성한다.** 신규 코드는 작고, 도메인/모델 빌더는 대부분 재사용한다.

---

## 3. 새 레이어드 아키텍처

```text
src/ui/
  core/                  ← 새 TUI 엔진 (의존성 0)
    ansi.ts              스타일 토큰 → 이스케이프 (color/bold/dim/inverse)
    capabilities.ts      truecolor/256/16/none 감지, NO_COLOR/FORCE_COLOR/TERM
    theme.ts             디자인 토큰(색·박스·아이콘) + 폴백 테이블
    renderer.ts          더블버퍼 diff 렌더러 (줄 단위 → 셀 단위 확장 가능)
    input.ts             바이트 → 시맨틱 키/페이스트/리사이즈 이벤트 디코더
    geometry.ts          기존 layout.ts 흡수 + 스크롤/스택/스플릿
  widgets/               ← 재사용 컴포넌트 (순수: model → string[])
    panel.ts list.ts table.ts progress.ts spinner.ts badge.ts
    statusbar.ts breadcrumb.ts toast.ts modal.ts helpOverlay.ts palette.ts
  app/                   ← MVU 런타임 (God class 대체)
    model.ts update.ts effects.ts keymap.ts runtime.ts
  screens/               ← 위젯으로 재작성된 공간별 view (순수 함수 유지)
  models/                ← 기존 studioData/nextActions 등 그대로 이전
```

### 3.1 더블버퍼 diff 렌더러 (헤드라인 수정)

전체 클리어를 없애고 **이전 프레임과 비교해 바뀐 줄만** 다시 그린다.

```ts
// core/renderer.ts (설계)
interface Renderer {
  render(lines: string[]): void;   // 이전 프레임과 diff → 변경 행만 커서 이동 후 재출력
  invalidate(): void;              // 리사이즈 시 전체 강제 재그리기
}
```

- 변경 줄만 `ESC[<row>;1H` + `ESC[2K` + 내용. `ESC[2J` 제거 → 깜빡임 소멸.
- 커서는 진입 시 1회만 숨김(`ESC[?25l`), 종료 시 복원.
- `output.on("resize")`(SIGWINCH)에서 `invalidate()` → 폭/높이 재계산.
- 1차는 줄 단위 diff(이 앱은 줄 전체 폭 콘텐츠라 충분). 필요 시 셀 단위로 확장.

### 3.2 입력 디코더 상태머신

`readInputChunk`의 "청크=키" 가정을 폐기하고 바이트 스트림을 시맨틱 이벤트로 변환한다.

```ts
// core/input.ts (설계)
type KeyEvent =
  | { type: "key"; name: "up"|"down"|"left"|"right"|"enter"|"escape"|"tab"
        |"backspace"|"home"|"end"|"pageup"|"pagedown"; ctrl?: boolean; alt?: boolean }
  | { type: "char"; value: string; ctrl?: boolean; alt?: boolean }
  | { type: "paste"; text: string }
  | { type: "resize"; cols: number; rows: number };
```

- CSI(`ESC [ … final`)/SS3(`ESC O x`) 파싱, **bracketed paste**(`ESC[200~ … ESC[201~`)를
  한 덩어리로, 단독 ESC는 **~40ms 타임아웃**으로 판별(ESC vs 화살표 모호성 해결).
- 한 청크에 여러 키가 와도 순차 디코딩 → 빠른 입력/붙여넣기 유실 방지.

### 3.3 테마 & 능력 감지

```ts
// core/theme.ts (설계)
const tokens = {
  accent, muted, focusBg,
  severity: { info, warning, critical, success },
  box: { style: "rounded" | "ascii", chars },
  icon: { bullet, check, cross, spinner }
};
```

- `capabilities.ts`: `NO_COLOR` / `FORCE_COLOR` / `COLORTERM` / `TERM=dumb` / `isTTY`
  검사 → truecolor→256→16→무색 자동 강등.
- 무색·dumb 터미널에선 ASCII 박스 + 텍스트 라벨로 폴백(현재 동작과 동일).

### 3.4 MVU 런타임 (God class 해체)

```ts
// app/update.ts (설계)
type Effect = { kind: "load-model"|"start-translation"|"run-export"|...; ... };
function update(model: AppModel, ev: KeyEvent | AppEvent): { model: AppModel; effects: Effect[] };
```

- `TerminalStudioApp`의 ~70개 메서드를 (1) 순수 `update`(상태 전이),
  (2) `effects`(비동기 부수효과: 번역 세션/내보내기/로드)로 분리한다.
- `keymap.ts`에서 **키→액션을 데이터로** 중앙 정의(공간별). `R`이 검수/복구로 갈리는
  분기도 한 곳에서 선언적으로. 키 일관성·도움말 자동 생성·리바인딩이 가능해진다.

---

## 4. 디자인 시스템

- **색 팔레트:** 중립 베이스 + 단일 액센트(브랜드색) + 의미색 4종
  (info / 주의 / 긴급 / 성공). 과채색 금지 — "연구실" 톤.
- **타이포/구조:** 둥근 유니코드 박스(`╭─╮│╰─╯`), 굵게=제목, dim=보조 메타,
  inverse=포커스 행.
- **포커스 모델:** 선택 행은 배경 반전 + 액센트 좌측 막대(`▌`). 현재 `>` 마커보다 즉각적.
- **프로그레스/모션:** 그라데이션 블록 프로그레스(`█▉▊…`, ASCII 폴백 `#`),
  Braille 스피너로 진행 중 표시. 1초 폴링 대신 작업 중일 때만 100~150ms 틱.
- **상태 위계:** 긴급/주의/안내를 색+뱃지(`●`)로. Glossary 충돌, QA 심각도, 실패 화에
  일관 적용.

---

## 5. 공간별 UX 재설계

공통 요소를 먼저 도입한다.

- **상단 Breadcrumb:** `책장 › 마도서관의 사서 › 용어 연구실` — 현재 위치 항상 표시.
- **하단 StatusBar:** 백엔드·모델·동시성·세션 상태·시계 고정 표시(키 힌트와 분리).
- **Toast:** 일시 메시지(`state.message`)를 자동 소멸 토스트로.
- **Modal:** 확인/입력을 화면 전체 재배치가 아니라 중앙 오버레이로.

| 공간 | 핵심 개선 |
|---|---|
| Bookshelf | 프로젝트 카드 그리드, 진행률 색 게이지, "이어하기" 히어로 카드 강조, 검색 즉시 필터 |
| Studio | 좌(진행/큐)·우(라이브 이벤트 스트림) 분할 고정, "지금 할 일"을 색 뱃지 카드로, 스피너로 활성 화 표시 |
| Glossary Lab | 검토 큐 가상 스크롤, 충돌은 적색 뱃지, 후보 신뢰도 막대, 단축 처리(확정/잠금/금칙/보류) |
| Review Desk | QA 이슈를 유형별 색 분류, 좌측 리스트·우측 원문/번역 대조 뷰 |
| Export Room | 체크박스를 토글 스위치 느낌으로, 실시간 미리보기(파일명/항목 수), 생성 진행률 |
| Settings | 섹션 탭 + 인라인 편집(피커 모달), 위험 항목(API키) 마스킹·뱃지 |
| Command Palette | 퍼지 매칭 + 하이라이트, 최근 사용, 확인 필요 명령 색 구분 |

---

## 6. 상호작용·내비게이션

- **중앙 키맵:** 전 공간 키를 한 테이블로. 충돌/오버로딩을 정적으로 검증,
  도움말·footer 자동 생성.
- **일관 내비:** `↑↓ / jk` 이동, `Enter` 실행, `Esc / b` 뒤로, `Tab` 패널 포커스 전환,
  `:`·Ctrl+K 팔레트, `?` 도움말 오버레이.
- **스크롤/페이지네이션:** 기존 `visibleWindow`를 위젯 List에 내장,
  PageUp/Down·Home/End 지원.
- **확인/되돌리기:** 파괴적 작업은 Modal 확인, 비파괴 작업은 Toast + `U` 되돌리기
  (기존 undo 자산 유지).

---

## 7. 접근성 & 폴백 (회귀 방지)

- 비-TTY: 현재처럼 1회 정적 출력(diff 렌더러 비활성).
- `NO_COLOR` / `TERM=dumb`: 무색 + ASCII 박스.
- 좁은 폭(<68): 2단 → 세로 스택(기존 로직 유지·강화).
- 스크린리더: diff 렌더링이 전체 재낭독을 줄여 오히려 유리. 핵심 변화는 토스트로
  한 줄 announce.

---

## 8. 마이그레이션 전략

- `view`는 계속 **순수 함수(model → string[])** → 기존 `uiScreens.test.ts` 스냅샷
  방식 유지. 렌더러/디코더/테마는 **신규 단위 테스트**(골든 프레임, 바이트 시퀀스,
  능력 강등 표).
- 런타임 의존성 0개 유지 → 커밋 dist + GitHub 설치 모델 그대로.
- 기존 모델 빌더(`studioData`, `nextActions`, `glossaryQueue` 등)는 거의 그대로
  재사용 — 재작성 대상은 **렌더/입력/런타임 레이어**지 도메인이 아니다.

---

## 9. 단계별 로드맵

각 Phase는 독립 빌드/테스트 통과 + 스모크(`self-test`) 통과를 게이트로 둔다.

- **Phase 0 — 코어 토대(체감 효과 최대, 위험 최소):**
  `ansi`/`capabilities`/`theme`/`renderer`(diff)/`input`(디코더)를 추가하고 기존
  render 경로에 끼워넣는다. *화면 구성은 그대로 두고* 전체클리어→diff, 청크→디코더,
  무색→테마만 교체. → 깜빡임 제거 + 색상 + 입력 안정화가 한 번에.
- **Phase 1 — 위젯·레이아웃:** `geometry`로 `layout.ts` 흡수,
  Panel/List/Table/Progress/Badge 등 위젯화. 화면을 위젯 위에 재구성.
- **Phase 2 — MVU 런타임:** `TerminalStudioApp` →
  `runtime`+`update`+`effects`+`keymap`으로 해체. 비동기 작업을 effect로.
- **Phase 3 — UX 폴리시:** Breadcrumb/StatusBar/Toast/Modal/HelpOverlay,
  팔레트 퍼지, 스피너/전환, (선택)마우스.
- **Phase 4 — 접근성·폴백·문서·스냅샷 갱신.**

---

## 10. 리스크 & 검증

- **diff 렌더러 경계버그**(리사이즈/높이초과): 골든 프레임 테스트 + `invalidate`
  강제 전체그리기로 방어.
- **ESC 타임아웃 튜닝:** 느린 SSH에서 화살표 오인식 가능 → 임계값 상수화·테스트.
- **CJK 폭 회귀:** 기존 `charCellWidth` 로직을 코어로 그대로 이전하고 폭 테스트 보강.
- **회귀 검증:** 기존 UI 테스트 + 신규 코어 테스트 + `npm run smoke`.

---

## 11. 한 줄 요약

NovelTrans 프론트엔드는 단색 ASCII를 매 키마다 전체 재그리는 투박한 콘솔에서,
**테마 색상 · diff 렌더링 · 견고한 입력 · MVU 구조**를 갖춘 터미널 번역 작업실로
재탄생한다. 가장 큰 레버는 **Phase 0** — 레이아웃을 건드리지 않고도 "투박함"의
대부분이 사라진다.

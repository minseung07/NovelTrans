# NovelTrans 기획서

## 1. 문서 목적

이 문서는 NovelTrans의 제품 방향, 기능 범위, 엔진 구조, 데이터 설계, 용어집 시스템, 번역 파이프라인, 배포 전략을 정의한다.

본 문서는 UI/UX 상세 설계를 포함하지 않는다.
UI/UX는 별도 기획서에서 다룬다.

---

## 2. 제품 개요

NovelTrans는 일본어 웹소설 및 장편 텍스트를 한국어로 번역하기 위한 프로젝트 기반 번역 도구다.

단순한 “텍스트 입력 → 번역 결과 출력” 도구가 아니라, 장편 번역에 필요한 다음 작업을 하나의 프로젝트 안에서 관리한다.

* 원문 입력
* 화 단위 분리
* 번역 실행
* 용어집 생성 및 관리
* 용어 일관성 유지
* 실패 재시도
* 이어 번역
* QA 검사
* TXT/EPUB 출력
* 프로젝트 상태 저장
* 결과 재생성

제품의 핵심은 **장편 번역 프로젝트 관리**와 **용어집 중심 번역 품질 관리**다.

---

## 3. 제품 목표

### 3.1 주 목표

NovelTrans의 주 목표는 장편 일본어 텍스트를 한국어로 안정적으로 번역하고, 프로젝트 단위로 관리할 수 있게 하는 것이다.

특히 웹소설처럼 화수가 많고 고유명사와 세계관 용어가 반복 등장하는 텍스트를 대상으로 한다.

### 3.2 특화 목표

NovelTrans의 특화 포인트는 용어집이다.

용어집은 단순 부가 기능이 아니라 번역 엔진의 핵심 구성 요소로 작동한다.

용어집은 다음 문제를 해결한다.

* 인명 번역 흔들림
* 지명 번역 불일치
* 스킬명, 아이템명, 단체명 오역
* 같은 원어가 여러 번역어로 번역되는 문제
* 금칙 번역어 사용
* 장편 후반부로 갈수록 번역 일관성이 무너지는 문제
* 재번역 시 이전 결정사항이 반영되지 않는 문제

### 3.3 최종 제품 방향

NovelTrans는 TypeScript 기반 단일 코드베이스로 설계한다.

번역 엔진, 프로젝트 관리, 용어집, QA, 출력 시스템을 모두 TypeScript로 통합한다.

목표 산출물은 사용자가 단일 CLI 프로그램처럼 실행할 수 있는 번역 작업 도구다.

---

## 4. 대상 사용자

### 4.1 1차 사용자

* 일본어 웹소설을 개인적으로 번역해 읽고 싶은 사용자
* 장편 텍스트를 여러 화 단위로 관리해야 하는 사용자
* 번역 품질보다 특히 용어 일관성에 민감한 사용자
* CLI/TUI 기반 작업에 익숙한 사용자
* API 기반 번역 워크플로우를 직접 통제하고 싶은 사용자

### 4.2 2차 사용자

* TXT 또는 EPUB 형태로 번역 결과를 보관하고 싶은 사용자
* 여러 작품을 프로젝트 단위로 관리하고 싶은 사용자
* 용어집을 직접 다듬으며 번역 품질을 개선하고 싶은 사용자
* 번역 실패, 재시도, 이어 번역이 필요한 긴 작업을 수행하는 사용자

---

## 5. 제품 원칙

### 5.1 프로젝트 중심

모든 작업은 프로젝트 단위로 관리한다.

한 번 실행하고 끝나는 번역 도구가 아니라, 장기적으로 이어서 작업할 수 있는 프로젝트 관리형 번역 도구를 지향한다.

프로젝트는 다음 정보를 포함한다.

* 원문
* 화 목록
* 번역 결과
* 번역 상태
* 용어집
* QA 결과
* 출력물
* 로그
* 설정
* 실행 이력

### 5.2 용어집 우선

번역 엔진은 항상 용어집을 참조한다.

용어집은 다음 단계에 개입한다.

* 번역 전 원문 분석
* 후보 용어 추출
* 번역 프롬프트 구성
* 번역 결과 검증
* 용어 충돌 탐지
* 금칙어 검사
* 결과물 부록 생성

### 5.3 이어 가능한 작업

장편 번역에서는 중단과 실패가 자연스럽게 발생한다.

따라서 모든 작업은 재개 가능해야 한다.

* 완료된 화는 다시 번역하지 않는다.
* 실패한 화만 재시도할 수 있다.
* 중간에 종료해도 상태가 저장된다.
* 출력 파일만 다시 만들 수 있다.
* 용어집 수정 후 일부 또는 전체를 재처리할 수 있다.

### 5.4 확장 가능한 엔진

번역 백엔드, 입력 형식, 출력 형식, QA 규칙, 용어집 추출기는 확장 가능하게 설계한다.

초기 버전은 최소한의 안정적인 기능을 제공하되, 구조적으로는 플러그인 또는 어댑터 확장이 가능해야 한다.

---

## 6. 범위 정의

## 6.1 포함 범위

NovelTrans의 핵심 포함 범위는 다음과 같다.

* TypeScript 기반 번역 엔진
* 프로젝트 생성 및 관리
* 로컬 원문 입력
* 화 단위 분리
* 번역 실행
* 번역 상태 저장
* 이어 번역
* 실패 화 재시도
* 용어집 후보 추출
* 용어집 확정, 수정, 잠금
* 용어 충돌 탐지
* 금칙 번역어 관리
* QA 검사
* TXT 출력
* EPUB 출력
* 설정 및 인증 정보 관리
* OpenAI-compatible API 연동
* dry-run 번역 백엔드
* 번역문 수동 편집기

## 6.2 제외 범위

초기 범위에서 제외하는 기능은 다음과 같다.

* 완전 자동 웹 크롤링
* 저작권 우회성 수집
* 로그인 세션 기반 본문 수집
* 웹 서버 기반 관리 화면
* 로컬 LLM 최적화

---

## 7. 시스템 아키텍처

## 7.1 전체 구조

NovelTrans는 다음 계층으로 구성한다.

```text
NovelTrans
├─ Application Layer
│  ├─ Command Router
│  ├─ Project Workflow
│  └─ Runtime State Manager
│
├─ Engine Layer
│  ├─ Source Analyzer
│  ├─ Episode Splitter
│  ├─ Translation Orchestrator
│  ├─ Translation Queue
│  ├─ Glossary Engine
│  ├─ QA Engine
│  └─ Export Engine
│
├─ Adapter Layer
│  ├─ OpenAI-compatible Adapter
│  ├─ Codex CLI Adapter
│  ├─ Dry-run Adapter
│  └─ Future Custom Adapters
│
├─ Storage Layer
│  ├─ Project File Store
│  ├─ SQLite Store
│  ├─ Config Store
│  └─ Credential Store
│
└─ Policy Layer
   ├─ Source Policy Engine
   ├─ Site Policy Registry
   └─ User Rights Confirmation
```

## 7.2 핵심 모듈

### Project Manager

프로젝트 생성, 로딩, 상태 조회, 경로 관리, 프로젝트 메타데이터 관리를 담당한다.

### Source Analyzer

입력 원문을 분석한다.

담당 기능:

* 파일 형식 감지
* 텍스트 인코딩 감지
* 언어 감지
* 화 제목 패턴 감지
* 화 단위 분리 가능성 판단
* 총 글자 수 계산
* 긴 화 감지
* 작가 후기 감지

### Episode Splitter

원문을 번역 가능한 화 단위로 분리한다.

지원 분리 기준:

* 명시적 화 제목
* 숫자 기반 제목
* 구분선
* 파일 단위
* 사용자 지정 규칙

### Translation Orchestrator

번역 실행 전체를 관리한다.

담당 기능:

* 번역 큐 생성
* 병렬 실행
* 실패 재시도
* 상태 저장
* 백엔드 호출
* 용어집 컨텍스트 주입
* 번역 결과 저장
* QA 호출
* 로그 기록

### Glossary Engine

용어집 관련 모든 작업을 담당한다.

담당 기능:

* 후보 용어 추출
* 용어 점수화
* 용어 확정
* 용어 잠금
* 금칙어 관리
* 충돌 탐지
* 번역 프롬프트용 용어 컨텍스트 생성
* QA용 용어 규칙 제공

### QA Engine

번역 결과의 구조적 문제를 검사한다.

담당 기능:

* 누락 문단 감지
* 일본어 잔존 감지
* 길이 비율 검사
* 숫자 보존 검사
* 용어 불일치 검사
* 이름 흔들림 검사
* 금칙어 검사
* 빈 번역 감지

### Export Engine

번역 결과를 최종 파일로 만든다.

초기 지원 형식:

* TXT
* EPUB

---

## 8. 번역 워크플로우

## 8.1 새 번역 흐름

새 번역의 기본 흐름은 다음과 같다.

```text
원문 입력
→ 원문 분석
→ 화 단위 분리
→ 프로젝트 생성
→ 용어 후보 사전 추출
→ 번역 설정 확정
→ 번역 큐 생성
→ 번역 실행
→ QA 검사
→ 결과 저장
→ TXT/EPUB 출력
```

## 8.2 이어 번역 흐름

기존 프로젝트를 다시 열면 프로젝트 상태를 기준으로 작업을 재개한다.

```text
프로젝트 로드
→ 화별 상태 확인
→ 완료 화 제외
→ 실패/대기 화 큐 생성
→ 기존 용어집 로드
→ 이어 번역 실행
→ QA 갱신
→ 출력물 재생성
```

## 8.3 실패 재시도 흐름

실패한 화만 다시 번역할 수 있다.

```text
실패 화 조회
→ 실패 원인 확인
→ 재시도 큐 생성
→ 백엔드 재호출
→ 성공 시 completed 처리
→ 실패 시 로그 갱신
```

## 8.4 결과 재생성 흐름

이미 번역된 프로젝트에서 출력 파일만 다시 만들 수 있다.

```text
프로젝트 로드
→ 번역 결과 확인
→ 출력 옵션 로드
→ TXT/EPUB 생성
→ 출력 경로 저장
```

---

## 9. 번역 단위 설계

## 9.1 Episode

기본 번역 단위는 Episode다.

```ts
type Episode = {
  id: string;
  episodeNo: number;
  title: string;
  sourceText: string;
  foreword?: string;
  body: string;
  afterword?: string;
  sourceHash: string;
  metadata: Record<string, unknown>;
};
```

## 9.2 Translation Result

번역 결과는 원문 Episode와 분리해 저장한다.

```ts
type TranslationResult = {
  episodeId: string;
  titleKo: string;
  forewordKo?: string;
  bodyKo: string;
  afterwordKo?: string;
  summary?: string;
  usedGlossaryEntries: string[];
  newGlossaryCandidates: string[];
  qaIssueIds: string[];
  model: string;
  backend: string;
  createdAt: string;
};
```

## 9.3 긴 화 분할

긴 화는 내부적으로 chunk 단위로 분할한다.

단, 사용자와 프로젝트 구조에서는 하나의 Episode로 유지한다.

```text
Episode 12
├─ chunk 1
├─ chunk 2
├─ chunk 3
└─ merged translation result
```

긴 화 분할 시 주의할 점:

* chunk별 문맥 손실 최소화
* 이전 chunk 요약 전달
* 최종 결과 병합
* QA는 병합 결과 기준으로 수행

---

## 10. 번역 백엔드 설계

## 10.1 백엔드 어댑터 인터페이스

모든 번역 백엔드는 동일한 인터페이스를 따른다.

```ts
interface TranslatorAdapter {
  id: string;
  label: string;

  checkAvailability(): Promise<AdapterStatus>;

  translateEpisode(input: TranslationInput): Promise<TranslationResult>;
}
```

## 10.2 초기 지원 백엔드

### OpenAI-compatible Adapter

OpenAI API 또는 OpenAI 호환 API를 호출한다.

지원 항목:

* API key
* base URL
* model
* temperature
* reasoning effort
* timeout
* retry
* streaming 여부

### Codex CLI Adapter

Codex CLI를 사용할 수 있는 환경에서 번역 백엔드로 연결한다.

지원 항목:

* Codex CLI 설치 여부 확인
* 로그인 상태 확인
* stdin 기반 요청 전달
* stdout 결과 파싱
* timeout 설정

### Dry-run Adapter

테스트와 개발용 백엔드다.

실제 API를 호출하지 않고 가짜 번역 결과를 생성한다.

용도:

* UI 개발
* 엔진 테스트
* 프로젝트 생성 테스트
* 출력 테스트
* QA 테스트

## 10.3 향후 확장 백엔드

향후 다음 백엔드를 검토할 수 있다.

* Anthropic-compatible adapter
* Gemini-compatible adapter
* local LLM adapter
* custom HTTP adapter
* user-defined script adapter

---

## 11. 용어집 시스템

## 11.1 용어집의 역할

용어집은 NovelTrans의 핵심 기능이다.

용어집은 다음 역할을 수행한다.

* 번역어 일관성 유지
* 고유명사 관리
* 별칭 관리
* 금칙 번역어 관리
* 충돌 탐지
* 번역 프롬프트 컨텍스트 제공
* QA 검사 기준 제공
* EPUB 부록 생성

## 11.2 용어집 항목 구조

```ts
type GlossaryEntry = {
  id: string;
  source: string;
  target: string | null;
  reading?: string;

  type:
    | "person"
    | "place"
    | "organization"
    | "skill"
    | "item"
    | "title"
    | "concept"
    | "term"
    | "unknown";

  status:
    | "candidate"
    | "confirmed"
    | "locked"
    | "forbidden"
    | "deprecated";

  aliases: string[];
  forbiddenTargets: string[];
  notes: string;

  confidence: number;
  sourceScore: number;
  targetScore: number;

  occurrenceCount: number;
  firstSeenEpisode: number | null;
  lastSeenEpisode: number | null;

  locked: boolean;
  createdAt: string;
  updatedAt: string;
};
```

## 11.3 용어 상태

### candidate

자동 추출된 후보 상태다.
아직 번역에 강하게 반영하지 않는다.

### confirmed

사용자가 승인한 용어다.
번역 프롬프트에 우선 반영한다.

### locked

반드시 지정 번역어를 사용해야 하는 용어다.
QA에서도 강하게 검사한다.

### forbidden

특정 번역어 사용을 금지하는 규칙이다.

### deprecated

더 이상 사용하지 않는 용어다.
기록은 남기되 번역 컨텍스트에는 포함하지 않는다.

## 11.4 후보 용어 추출

후보 추출 대상은 다음과 같다.

* 반복 등장하는 고유명사
* 인명 후보
* 지명 후보
* 단체명 후보
* 스킬명
* 아이템명
* 칭호
* 괄호나 따옴표로 강조된 명칭
* 번역 결과에서 흔들리는 표현

## 11.5 후보 점수화

후보 용어는 다음 기준으로 점수화한다.

* 등장 빈도
* 여러 화에 걸친 등장 여부
* 문맥상 고유명사 가능성
* 문자 패턴
* 기존 용어집과의 유사도
* 번역 결과에서의 흔들림 정도
* 사용자가 확정한 유사 용어와의 관계

## 11.6 용어집 적용 엄격도

용어집 적용 엄격도는 네 단계로 둔다.

```text
low      참고용
medium   주요 확정 용어 우선 적용
high     확정 용어 강하게 적용
strict   locked 용어와 금칙어를 강제 검증
```

기본값은 high다.

## 11.7 충돌 탐지

같은 원어가 여러 번역어로 번역되면 충돌로 기록한다.

예시:

```text
黒架
- 흑가
- 쿠로카
- 검은 시렁
```

충돌은 다음 방식으로 해결한다.

* 하나를 대표 번역어로 확정
* 별칭으로 등록
* 문맥별 용어로 분리
* 특정 번역어를 금칙어로 등록
* 후보를 폐기

## 11.8 금칙 번역어

금칙 번역어는 특정 원어에 대해 사용하면 안 되는 번역어다.

예시:

```text
source: 魔王
allowed target: 마왕
forbidden targets:
- 악마왕
- 데몬킹
```

QA Engine은 금칙 번역어가 번역 결과에 등장하면 이슈로 기록한다.

## 11.9 용어집 import/export

용어집은 외부 파일과 호환되어야 한다.

지원 형식:

* JSON
* CSV

사용 목적:

* 프로젝트 간 용어집 재사용
* 수동 편집
* 백업
* 공유
* 대량 수정

---

## 12. QA 시스템

## 12.1 QA의 목적

QA는 번역 품질을 완벽히 평가하는 기능이 아니다.
대신 장편 번역에서 반복적으로 발생하는 구조적 문제를 탐지하는 기능이다.

## 12.2 검사 항목

초기 QA 항목은 다음과 같다.

* 빈 번역 결과
* 누락 문단 의심
* 일본어 잔존
* 숫자 누락 또는 변형
* 원문 대비 길이 비율 이상
* 확정 용어 미사용
* locked 용어 위반
* 금칙 번역어 사용
* 이름 흔들림
* 반복 문장
* 비정상적으로 짧은 번역

## 12.3 QA Issue 구조

```ts
type QAIssue = {
  id: string;
  episodeId: string;
  type:
    | "empty_translation"
    | "missing_paragraph"
    | "japanese_remaining"
    | "number_mismatch"
    | "length_ratio"
    | "glossary_mismatch"
    | "locked_term_violation"
    | "forbidden_term"
    | "name_inconsistency"
    | "repetition"
    | "other";

  severity: "info" | "warning" | "error";
  message: string;
  sourceSnippet?: string;
  targetSnippet?: string;
  relatedGlossaryEntryId?: string;
  resolved: boolean;
  createdAt: string;
};
```

## 12.4 QA 결과 저장

QA 결과는 화별로 저장하고, 프로젝트 단위 리포트를 생성한다.

```text
logs/
  episode_001.qa.json
  episode_002.qa.json
  quality_report.json
  quality_report.txt
```

---

## 13. 출력 시스템

## 13.1 지원 출력 형식

초기 지원 출력 형식은 다음과 같다.

* TXT
* EPUB

DOCX는 초기 범위에서 제외한다.

## 13.2 TXT 출력

TXT 출력은 가장 단순하고 호환성 높은 결과물이다.

옵션:

* 화 제목 포함
* 원작 메타데이터 포함
* 작가 후기 포함
* 용어집 부록 포함
* 워터마크 포함
* 구분선 스타일 선택

## 13.3 EPUB 출력

EPUB 출력은 전자책 리더 사용을 목표로 한다.

옵션:

* 제목
* 작가
* 번역 메타데이터
* 목차
* 화별 챕터
* 작가 후기
* 용어집 부록
* 세로쓰기
* 사용자 CSS
* 표지 이미지

## 13.4 결과 재생성

번역 결과가 이미 존재하면, 번역을 다시 하지 않고 출력물만 재생성할 수 있어야 한다.

사용 사례:

* 용어집 부록 포함 여부 변경
* EPUB 세로쓰기 변경
* 워터마크 변경
* TXT만 다시 생성
* EPUB만 다시 생성
* 출력 테마 변경

---

## 14. 프로젝트 저장 구조

기본 프로젝트 구조는 다음과 같다.

```text
projects/
  my_novel/
    project.json
    project.db

    source/
      episode_001.json
      episode_002.json

    translated/
      episode_001.md
      episode_002.md

    glossary/
      glossary.json
      conflicts.json
      forbidden.json

    exports/
      my_novel.txt
      my_novel.epub

    logs/
      translation.log
      qa.log
      estimate.json
      quality_report.json
      quality_report.txt
```

## 14.1 project.json

사람이 읽을 수 있는 프로젝트 메타데이터를 저장한다.

포함 정보:

* 프로젝트 이름
* 원작 제목
* 작가
* 원본 경로
* 원본 URL
* 생성일
* 마지막 실행일
* 번역 옵션
* 출력 옵션
* 정책 정보

## 14.2 project.db

상태 조회와 이력 관리가 필요한 데이터를 저장한다.

포함 정보:

* 화별 상태
* 번역 작업 이력
* QA 이슈
* 용어집 인덱스
* 실행 로그 요약
* 토큰 사용량
* 비용 추정
* 백엔드 호출 이력

## 14.3 파일 저장 원칙

원문과 번역문은 가능한 한 사람이 읽고 수정하기 쉬운 형태로 저장한다.

* 원문: JSON
* 번역문: Markdown
* 리포트: JSON + TXT
* 용어집: JSON + CSV export 가능

---

## 15. 상태 모델

## 15.1 Episode Status

각 화는 다음 상태 중 하나를 가진다.

```text
pending
running
completed
failed
skipped
```

## 15.2 Project Status

프로젝트는 다음 상태를 가진다.

```text
created
analyzed
ready
translating
paused
completed
completed_with_issues
failed
exported
```

## 15.3 Job Status

각 번역 작업은 다음 상태를 가진다.

```text
queued
running
completed
failed
cancelled
```

---

## 16. 설정 및 인증

## 16.1 설정 저장 위치

기본 설정 경로는 다음과 같다.

```text
~/.config/noveltrans/config.json
```

설정 항목:

* 기본 프로젝트 경로
* 기본 번역 백엔드
* 기본 모델
* 기본 병렬 처리 수
* 기본 출력 형식
* 기본 용어집 엄격도
* 기본 QA 옵션
* 기본 EPUB 옵션
* 정책 설정
* 로그 레벨

## 16.2 인증 정보 저장

API Key는 일반 설정 파일에 평문으로 저장하지 않는다.

우선순위:

```text
1. 환경변수
2. OS keychain
3. 로컬 암호화 저장소
```

지원 환경변수:

```text
OPENAI_API_KEY
NOVELTRANS_API_BASE_URL
NOVELTRANS_CONFIG_DIR
```

## 16.3 인증 상태 확인

앱은 번역 실행 전 백엔드 사용 가능 여부를 확인한다.

확인 항목:

* API Key 존재 여부
* base URL 접근 가능 여부
* 모델명 설정 여부
* Codex CLI 설치 여부
* Codex CLI 로그인 여부
* dry-run 사용 여부

---

## 17. 정책 및 안전장치

## 17.1 원문 처리 원칙

NovelTrans는 사용자가 처리 권한을 가진 원문만 다룬다.

사용자는 새 프로젝트 생성 시 다음을 확인해야 한다.

* 원문을 개인적이고 합법적인 범위에서 처리할 권한이 있음
* 번역 결과를 무단 재배포하지 않음
* 사이트 정책을 위반하는 자동 수집을 하지 않음

## 17.2 사이트 정책

사이트 정책은 다음 상태로 관리한다.

```text
allowed
metadata_only
user_file_required
blocked
unknown
```

정책이 unknown인 경우 자동 본문 수집은 허용하지 않는다.

## 17.3 URL 처리

URL은 다음 목적에 사용할 수 있다.

* 작품 메타데이터 보존
* 출처 기록
* 정책 확인
* 사용자가 제공한 원문과 연결

자동 본문 수집은 별도 정책 허용이 있는 경우에만 수행한다.

---

## 18. 로깅 및 관측성

## 18.1 로그 종류

NovelTrans는 다음 로그를 남긴다.

```text
translation.log
qa.log
glossary.log
export.log
error.log
```

## 18.2 실행 이력

각 실행은 run record로 저장한다.

```ts
type RunRecord = {
  id: string;
  projectId: string;
  type: "translate" | "retry" | "export" | "qa" | "glossary";
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  backend?: string;
  model?: string;
  episodeCount?: number;
  errorMessage?: string;
};
```

## 18.3 비용 및 토큰 추정

가능한 경우 다음 정보를 저장한다.

* 입력 토큰 추정
* 출력 토큰 추정
* 실제 사용량
* 예상 비용
* 실제 비용
* 모델명
* 백엔드

---

## 19. 배포 전략

## 19.1 기본 방향

NovelTrans는 TypeScript 단일 코드베이스로 개발하고, 최종적으로 OS별 실행 파일 또는 release bundle로 배포한다.

목표:

* 사용자가 별도 Python 런타임을 설치하지 않아도 됨
* 의존성 설치 과정을 최소화
* 설정과 프로젝트 데이터는 사용자 홈 디렉터리에 저장
* 업데이트가 단순해야 함

## 19.2 배포 형태

초기 배포 형태:

```text
noveltrans
```

또는 OS별 압축 패키지:

```text
noveltrans-windows-x64.zip
noveltrans-macos-arm64.zip
noveltrans-linux-x64.tar.gz
```

## 19.3 개발자 배포

개발자용 설치는 npm 패키지로 제공할 수 있다.

```text
npm install -g noveltrans
```

## 19.4 일반 사용자 배포

일반 사용자용은 단일 실행 파일 또는 실행 파일 포함 bundle로 제공한다.

포함 항목:

* 실행 파일
* 기본 정책 데이터
* 기본 프롬프트 템플릿
* 기본 EPUB 스타일
* 라이선스
* README

---

## 20. 테스트 전략

## 20.1 단위 테스트

대상:

* 화 분리
* 원문 분석
* 용어 후보 추출
* 용어 충돌 탐지
* QA 규칙
* TXT export
* EPUB export
* 설정 로딩
* 상태 전이

## 20.2 통합 테스트

대상:

* 새 프로젝트 생성
* dry-run 번역
* 이어 번역
* 실패 화 재시도
* 용어집 수정 후 재번역
* 결과 재생성
* 설정 저장 및 로드

## 20.3 회귀 테스트

고정 샘플 원문을 두고 다음을 검증한다.

* 화 수가 동일하게 분리되는가
* 번역 상태가 정상 저장되는가
* 용어집 후보 수가 비정상적으로 변하지 않는가
* TXT/EPUB 출력이 생성되는가
* QA 리포트가 생성되는가

## 20.4 실패 테스트

의도적으로 다음 상황을 만든다.

* API timeout
* 잘못된 API Key
* 빈 응답
* 비정상 JSON 응답
* 디스크 쓰기 실패
* 중간 종료
* 프로젝트 DB 손상
* 원문 파일 삭제
* 출력 경로 권한 없음

---

## 21. MVP 범위

## 21.1 MVP 목표

MVP의 목표는 “하나의 TXT 원문을 프로젝트로 만들고, dry-run 또는 OpenAI-compatible API로 번역한 뒤, 용어집과 QA를 거쳐 TXT/EPUB로 출력할 수 있는 것”이다.

## 21.2 MVP 포함 기능

* TypeScript 기반 프로젝트 구조
* 로컬 TXT 입력
* 화 단위 분리
* 프로젝트 생성
* SQLite 상태 저장
* OpenAI-compatible 번역
* Codex CLI adapter
* dry-run 번역
* 병렬 번역
* 실패 재시도
* 이어 번역
* 기본 용어 후보 추출
* 용어 확정/수정/잠금
* 용어 충돌 탐지
* 기본 QA
* TXT 출력
* EPUB 출력
* 설정 파일
* API Key 저장
* 기본 로그

## 21.3 MVP 제외 기능

* URL 자동 본문 수집
* HTML/ZIP 입력
* 고급 EPUB 테마
* 용어집 CSV import/export
* 고급 QA
* 로컬 LLM
* 플러그인 시스템
* GUI
* 클라우드 기능

---

## 22. 1차 정식 버전 범위

MVP 이후 1차 정식 버전에서는 다음 기능을 추가한다.

* HTML 입력
* ZIP 입력
* URL 메타데이터 보존
* 용어집 CSV/JSON import/export
* 금칙 번역어 관리
* 용어집 EPUB 부록
* 고급 QA 리포트
* 토큰/비용 추정
* 프로젝트 검색
* OS별 release bundle
* 정책 레지스트리
* 출력 옵션 확장

---

## 23. 장기 확장 방향

장기적으로 다음 기능을 검토한다.

* 번역 메모리
* 다중 모델 비교 번역
* 프로젝트 간 용어집 공유
* 작품 시리즈 단위 관리
* 커스텀 프롬프트 템플릿
* 플러그인 시스템
* 로컬 LLM adapter
* 수동 교정 편집기
* diff 기반 재번역
* 웹 UI
* 데스크톱 앱
* 클라우드 백업
* EPUB 테마 확장

---

## 24. 주요 리스크

## 24.1 번역 품질 리스크

모델 출력은 항상 불안정할 수 있다.

대응:

* 용어집 컨텍스트 강화
* QA 검사
* 실패 재시도
* 응답 형식 검증
* dry-run 테스트

## 24.2 용어집 과적용 리스크

용어집을 너무 강하게 적용하면 문맥상 어색한 번역이 발생할 수 있다.

대응:

* 엄격도 옵션 제공
* locked 용어와 confirmed 용어 구분
* 문맥별 별칭 지원
* deprecated 상태 지원

## 24.3 장편 처리 성능 리스크

화 수가 많거나 원문이 길면 처리 시간이 길어진다.

대응:

* 병렬 처리
* 긴 화 chunking
* 상태 저장
* 이어 번역
* 실패 화만 재시도

## 24.4 배포 리스크

단일 실행 파일 배포 시 OS별 차이가 발생할 수 있다.

대응:

* OS별 CI 빌드
* release bundle 제공
* 개발자용 npm 설치 병행
* dry-run self-test 제공

## 24.5 데이터 손상 리스크

프로젝트 DB나 파일이 손상될 수 있다.

대응:

* atomic write
* 자동 백업
* project.json과 project.db 역할 분리
* export 전 검증
* 복구 명령 제공

---

## 25. 성공 기준

## 25.1 기능 성공 기준

* 사용자가 TXT 원문으로 새 프로젝트를 만들 수 있다.
* 원문이 화 단위로 분리된다.
* 번역 상태가 화별로 저장된다.
* 중간 종료 후 이어 번역할 수 있다.
* 실패한 화만 재시도할 수 있다.
* 용어집 후보가 자동 생성된다.
* 용어를 확정하고 이후 번역에 반영할 수 있다.
* 용어 충돌이 탐지된다.
* QA 리포트가 생성된다.
* TXT와 EPUB 출력물이 생성된다.

## 25.2 제품 성공 기준

* 사용자는 하나의 실행 파일 또는 단순 설치 명령으로 앱을 사용할 수 있다.
* 기본 설정만으로도 번역 작업을 시작할 수 있다.
* 장편 프로젝트를 안정적으로 재개할 수 있다.
* 용어집 관리가 제품의 핵심 가치로 작동한다.
* 번역 결과와 프로젝트 데이터가 사용자가 이해 가능한 구조로 저장된다.

## 25.3 품질 성공 기준

* 100화 규모의 샘플 프로젝트를 dry-run으로 끝까지 처리할 수 있다.
* API timeout이나 실패 응답이 발생해도 전체 프로젝트가 손상되지 않는다.
* completed 상태의 화는 이어 번역 시 중복 처리되지 않는다.
* export만 반복 실행해도 결과가 안정적으로 생성된다.
* 용어집 수정 후 QA 결과가 갱신된다.

---

## 26. 최종 제품 정의

NovelTrans는 장편 일본어 텍스트를 한국어로 번역하기 위한 TypeScript 기반 프로젝트형 번역 도구다.

핵심 가치는 다음 세 가지다.

1. **장편 번역의 재개 가능성**

   * 화별 상태 저장, 이어 번역, 실패 재시도

2. **용어집 중심의 일관성 관리**

   * 후보 추출, 확정, 잠금, 금칙어, 충돌 탐지, QA 연동

3. **읽을 수 있는 결과물 생성**

   * TXT와 EPUB 출력, 결과 재생성, 용어집 부록

NovelTrans는 빠른 일회성 번역기가 아니라, 하나의 작품을 장기적으로 관리하고 완성도 있는 번역 결과물로 정리하기 위한 번역 작업 엔진이다.

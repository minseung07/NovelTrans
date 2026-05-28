# NovelTrans CLI

일본 웹소설 원문을 한국어로 번역하고, 결과를 `TXT`와 `EPUB`로 내보내는 터미널 기반 작업 도구입니다.

NovelTrans는 저작권 침해, 유료 콘텐츠 우회, 로그인 세션 탈취, CAPTCHA 우회, 사이트 약관 위반 목적의 자동 수집을 지원하지 않습니다. 자동 본문 수집이 안전하지 않은 사이트는 URL을 메타데이터 보존용으로만 사용하고, 본문은 사용자가 직접 제공한 파일이나 붙여넣기로 처리합니다.

<img width="2007" height="522" alt="image" src="https://github.com/user-attachments/assets/7a5fdc06-a82e-4698-9d0a-082a693c85c5" />

## 핵심 기능

- `noveltrans` 실행만으로 열리는 키보드 기반 터미널 마법사
- 새 번역, 이어 번역, 결과 파일 재생성, 도구와 설정으로 나뉜 작업 중심 첫 화면
- 원문 입력 후 바로 번역 준비 요약을 보여주는 간단한 새 작업 흐름
- 설정과 새 작업에서 같은 선택 화면을 공유하는 원본 입력, 속도, 번역 모드, 출력, 검토 옵션
- 로컬 `TXT`, `HTML`, `ZIP`, 클립보드 붙여넣기, 직접 입력, `$EDITOR` 입력 지원
- 사이트 정책 게이트와 권한 확인 흐름
- 에피소드 단위 비동기 번역 큐, 실패 재시도, 이어 번역
- OpenAI Responses API, Codex CLI, dry-run 번역 백엔드
- 용어집 자동 후보 추출, 대기 후보 검토, 별칭/금칙 번역어, 충돌 추적, 잠금
- 누락 문단, 길이 비율, 일본어 잔존, 숫자, 용어 일관성, 이름 흔들림, 금칙어 QA
- `TXT`와 개선된 `EPUB` 내보내기
- SQLite 프로젝트 DB와 파일 기반 프로젝트 구조
- 사이트 정책 JSON 가져오기와 커넥터 플러그인 진입점

## 설치와 실행

개발 환경에서는 고정된 `uv` 환경을 권장합니다.

```bash
make sync-frozen
.venv/bin/noveltrans
```

일반 가상환경으로 설치할 수도 있습니다.

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e ".[dev]"
noveltrans
```

터미널 마법사는 방향키 또는 `j`/`k`로 이동하고, Enter로 선택합니다. 다중 선택 화면에서는 Space로 토글합니다. `b` 또는 Backspace는 이전 화면입니다.

## 첫 화면

`noveltrans`를 실행하면 다음 작업만 먼저 보입니다.

- `새 원문 번역`: 원문을 넣고 번역 준비 요약에서 바로 시작
- `이어서 번역`: 기존 프로젝트의 미완료/실패 화 처리, 원문 추가, 검증, 리포트, 출력, 프로젝트 용어집 관리
- `결과 파일 다시 만들기`: 이미 번역된 프로젝트에서 `TXT`/`EPUB` 재생성
- `도구와 설정`: 인증, 번역 기본값, 출력 기본값, 안전/정책, 고급 설정, 용어집 도구

새 번역 작업은 먼저 원문을 받습니다. 그 다음 아래처럼 짧은 요약을 보여주고, 사용자는 바로 시작하거나 필요한 항목만 바꿀 수 있습니다.

```text
번역 준비 완료
  프로젝트: my_novel
  원본: source.txt
  분량: 전체
  결과 파일: TXT, EPUB
  번역: 균형 번역
  속도: 빠르게 4화씩
  검토: 품질, 용어
```

자주 바꾸는 항목은 `바꾸기`에 있습니다.

- 원본
- 프로젝트 이름
- 번역 범위
- 결과 파일
- 번역 모드
- 속도

세부 항목은 `고급 설정`에 있습니다.

- 번역 방식과 모델
- 문체, 존댓말/호칭, 용어집 엄격도, 문장 변형 정도
- 품질 검사, 이름/용어 흔들림 검사, 누락 문단 검사, 길이 비율 검사
- 용어집 부록, 작가 후기 출력, EPUB 세로쓰기

설정 화면과 새 작업 화면은 같은 선택 도구를 사용합니다. 예를 들어 속도는 항상 `차분하게 1화씩`, `보통 2화씩`, `빠르게 4화씩`, `최대 8화씩` 중에서 고릅니다. 번역 모드를 바꾸면 실제 문체, temperature, 용어집 엄격도, 추론 강도 기본값도 함께 갱신됩니다.

## 출력 형식

현재 공식 지원 출력 형식은 `TXT`와 `EPUB`입니다. `DOCX` 출력은 v1 범위에서 제거되었습니다. 오래된 설정이나 프로젝트 manifest에 남아 있는 `docx` 값은 `txt`/`epub` 기준으로 정리되며, CLI에서 `--formats docx`처럼 명시적으로 요청하면 오류로 안내합니다.

## 빠른 사용 예시

로컬 파일로 dry-run을 실행합니다.

```bash
noveltrans run-local \
  --name demo \
  --input sample.txt \
  --dry-run \
  --confirm-rights \
  --no-redistribute \
  --formats txt,epub
```

Codex CLI 로그인 세션으로 실제 번역을 실행합니다.

```bash
codex login
noveltrans auth codex-status
noveltrans run-local \
  --name demo \
  --input sample.txt \
  --backend codex \
  --glossary-updates safe \
  --glossary-strictness high \
  --confirm-rights \
  --no-redistribute \
  --formats txt,epub
```

자동 본문 수집이 아닌 사용자 제공 원문으로 URL 메타데이터를 보존합니다.

```bash
noveltrans run-url \
  --name demo \
  --url https://syosetu.org/novel/123/ \
  --fallback-file saved.txt \
  --episodes 1-3 \
  --dry-run \
  --confirm-rights \
  --no-redistribute
```

기존 프로젝트에 새 원문을 추가하고 미번역 화만 처리합니다.

```bash
noveltrans add-source --project demo --input new_saved_episodes.txt --translate --dry-run --confirm-rights --no-redistribute
noveltrans status --project demo
noveltrans estimate --project demo
```

결과 파일만 다시 만듭니다.

```bash
noveltrans export --project demo --formats txt,epub
noveltrans report --project demo
noveltrans verify --project demo
```

## 인증

기본 실제 번역 백엔드는 OpenAI Responses API입니다. API key 또는 호환 OAuth/Bearer access token은 설정 메뉴나 CLI 명령으로 저장할 수 있습니다.

```bash
noveltrans auth login
printf '%s\n' "$OPENAI_API_KEY" | noveltrans auth set-api-key --from-stdin
noveltrans auth status
noveltrans auth clear-api-key
```

Codex CLI 백엔드도 사용할 수 있습니다.

```bash
codex login
noveltrans auth codex-status
noveltrans run-local --name demo --input sample.txt --backend codex --confirm-rights --no-redistribute
```

Codex 백엔드는 `codex login status`를 확인하고 각 번역 작업을 `codex exec`에 stdin으로 전달합니다. Codex의 캐시된 인증 정보를 읽거나 복사하거나 수정하지 않습니다.

## 사이트 정책

NovelTrans는 사이트별 정책을 기준으로 본문 자동 수집 여부를 제한합니다.

- 青空文庫: 허용 조건을 확인한 공개 파일 중심 지원
- 小説家になろう: 공식 API 메타데이터 중심, 본문은 사용자 제공 원문 필요
- カクヨム: 공개 게스트 페이지 제한 지원 또는 사용자 제공 원문
- ハーメルン, pixiv 등 제한 사이트: URL 메타데이터 또는 사용자 제공 원문 중심

정책 업데이트 JSON을 가져와 자동 수집 가능 여부를 바꿀 수 있습니다.

```bash
noveltrans policy import --file policies.json
noveltrans policy import --url https://example.com/noveltrans-policies.json --save-url
noveltrans policy refresh
noveltrans policy show --site 青空
```

## 프로젝트 구조

새 프로젝트는 기본적으로 `projects/` 아래에 생성됩니다.

```text
projects/
  my_novel/
    project.json
    project.db
    source/
    translated/
    glossary/
    exports/
    logs/
```

`project.json`은 현재 manifest 형식입니다. 이전 로컬 빌드에서 생성한 `project.yaml`도 읽기 호환성을 유지합니다.

## 개발

개발 의존성 설치와 테스트는 다음 명령을 사용합니다.

```bash
uv --cache-dir .uv-cache sync --dev
uv --cache-dir .uv-cache run pytest -q
uv --cache-dir .uv-cache run noveltrans --version
```

표준 라이브러리 unittest만 실행할 수도 있습니다.

```bash
make compile
make test-unittest
make doctor
make smoke
```

릴리스 전에는 strict doctor를 실행합니다.

```bash
noveltrans doctor --strict
```

## 플러그인

서드파티 커넥터는 `noveltrans.connectors` entry point group으로 로드됩니다. 자세한 내용은 [docs/plugin_sdk.md](docs/plugin_sdk.md)와 [examples/connectors/example_connector.py](examples/connectors/example_connector.py)를 참고하세요.

## 용어집 정책

용어집은 장편 번역의 이름/지명/스킬/설정 일관성을 관리하는 프로젝트별 지식베이스입니다. 자동 추출 용어는 먼저 evidence가 붙은 `candidate`로 저장되고, 모델 응답은 `GlossaryProposal`로 검증된 뒤 safe merge만 `accepted_auto`로 반영됩니다. 기존 target 교체, `accepted_user`, `locked` 변경은 자동 처리하지 않고 conflict/review로 남깁니다. 상태값, proposal audit, 금칙 번역어, QA 규칙은 [docs/glossary.md](docs/glossary.md)에 정리되어 있습니다.

## 라이선스

NovelTrans CLI는 MIT 라이선스로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.

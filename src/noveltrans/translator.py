"""Translation backends."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from typing import Any

from .errors import TranslationError
from .models import EpisodeText, GlossaryEntry, GlossaryProposal, TermConflict, TranslationOptions, TranslationResult
from .prompts import SYSTEM_PROMPT, TRANSLATION_SCHEMA, build_episode_payload


SUPPORTED_TRANSLATION_BACKENDS = {"auto", "openai", "codex", "dry-run"}


class Translator(ABC):
    @abstractmethod
    def translate_episode(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str = "",
    ) -> TranslationResult:
        raise NotImplementedError


class DryRunTranslator(Translator):
    """Offline translator that validates pipeline shape without calling an API."""

    def translate_episode(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str = "",
    ) -> TranslationResult:
        body = _section_text(episode, "body") or episode.all_text()
        foreword = _section_text(episode, "foreword")
        afterword = _section_text(episode, "afterword")
        return TranslationResult(
            title_ko=f"{episode.title} [DRY-RUN]",
            foreword_ko=_dry_run_text(foreword),
            body_ko=_dry_run_text(body),
            afterword_ko=_dry_run_text(afterword) if options.translate_author_notes else "",
            new_terms=[],
            term_conflicts=[],
            episode_summary=f"Dry-run summary for episode {episode.episode_no}.",
            qa_notes=["dry-run translator used; no real translation was performed"],
            raw_response={"backend": "dry-run"},
        )


class CodexCLI:
    """Small wrapper around the Codex CLI.

    NovelTrans intentionally treats Codex as an external authenticated CLI and
    does not read or copy Codex's cached OAuth credentials.
    """

    def __init__(self, command: str = "codex", timeout: int = 600) -> None:
        self.command = command.strip() or "codex"
        self.timeout = timeout

    def executable(self) -> str:
        path = shutil.which(self.command)
        if not path:
            raise TranslationError(
                "Codex CLI를 찾지 못했습니다. Codex를 설치한 뒤 `codex login`으로 로그인하세요."
            )
        return path

    def is_installed(self) -> bool:
        return shutil.which(self.command) is not None

    def login_status(self) -> tuple[bool, str]:
        try:
            executable = self.executable()
        except TranslationError as exc:
            return False, str(exc)
        try:
            completed = subprocess.run(
                [executable, "login", "status"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            return False, "codex login status timed out"
        except OSError as exc:
            return False, str(exc)
        detail = (completed.stdout or completed.stderr or "").strip()
        return completed.returncode == 0, detail

    def login(self, device_auth: bool = False) -> tuple[bool, str]:
        executable = self.executable()
        command = [executable, "login"]
        if device_auth:
            command.append("--device-auth")
        try:
            completed = subprocess.run(command, check=False, text=True)
        except OSError as exc:
            raise TranslationError(f"Codex login 실행에 실패했습니다: {exc}") from exc
        return completed.returncode == 0, f"exit={completed.returncode}"

    def exec(self, prompt: str) -> str:
        executable = self.executable()
        try:
            completed = subprocess.run(
                [executable, "exec", "-"],
                check=False,
                capture_output=True,
                input=prompt,
                text=True,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise TranslationError(f"Codex exec timed out after {self.timeout}s") from exc
        except OSError as exc:
            raise TranslationError(f"Codex exec 실행에 실패했습니다: {exc}") from exc
        if completed.returncode != 0:
            details = (completed.stderr or completed.stdout or "").strip()
            raise TranslationError(f"Codex exec failed with exit={completed.returncode}: {details}")
        return completed.stdout or completed.stderr


class CodexTranslator(Translator):
    """Translator backend that delegates model calls to `codex exec`."""

    def __init__(self, codex_cli: CodexCLI | None = None) -> None:
        self.codex_cli = codex_cli or CodexCLI()

    def translate_episode(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str = "",
    ) -> TranslationResult:
        prompt = self._build_prompt(episode, options, glossary, previous_summary)
        output = self.codex_cli.exec(prompt)
        payload = extract_translation_payload(output)
        return result_from_payload(payload, raw_response={"backend": "codex", "raw_output": output})

    def _build_prompt(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str,
    ) -> str:
        return (
            "You are running as a translation backend for NovelTrans CLI.\n"
            "Do not use shell commands, edit files, browse the web, or call tools.\n"
            "Return exactly one JSON object and no Markdown fences or commentary.\n\n"
            f"{SYSTEM_PROMPT}\n\n"
            "The JSON object must satisfy this schema:\n"
            f"{json.dumps(TRANSLATION_SCHEMA, ensure_ascii=False, indent=2)}\n\n"
            "Translate this episode payload:\n"
            f"{build_episode_payload(episode, options, glossary, previous_summary)}"
        )


class OpenAITranslator(Translator):
    """OpenAI Responses API translator using stdlib HTTP."""

    endpoint = "https://api.openai.com/v1/responses"

    def __init__(
        self,
        api_key: str,
        timeout: int = 120,
        max_retries: int = 2,
        organization: str = "",
        project: str = "",
    ) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout
        self.max_retries = max_retries
        self.organization = organization.strip()
        self.project = project.strip()
        if not self.api_key:
            raise TranslationError("OpenAI API key is required for OpenAITranslator")

    def translate_episode(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str = "",
    ) -> TranslationResult:
        payload = self._build_request(episode, options, glossary, previous_summary)
        data = self._post(payload)
        text = self._extract_text(data)
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise TranslationError(f"OpenAI response was not valid JSON: {exc}") from exc
        return result_from_payload(parsed, raw_response=data)

    def _build_request(
        self,
        episode: EpisodeText,
        options: TranslationOptions,
        glossary: list[GlossaryEntry],
        previous_summary: str,
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "model": options.model,
            "input": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_episode_payload(episode, options, glossary, previous_summary)},
            ],
            "reasoning": {"effort": options.reasoning_effort},
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "episode_translation",
                    "schema": TRANSLATION_SCHEMA,
                    "strict": True,
                },
                "verbosity": "medium",
            },
        }
        if options.temperature is not None and not options.model.startswith("gpt-5"):
            request["temperature"] = options.temperature
        return request

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "NovelTransCLI/1.0",
        }
        if self.organization:
            headers["OpenAI-Organization"] = self.organization
        if self.project:
            headers["OpenAI-Project"] = self.project
        request = urllib.request.Request(
            self.endpoint,
            data=body,
            headers=headers,
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    response_body = response.read().decode("utf-8")
                return json.loads(response_body)
            except urllib.error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace")
                last_error = TranslationError(f"OpenAI API HTTP {exc.code}: {details}")
                if exc.code not in {408, 409, 429, 500, 502, 503, 504}:
                    break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
            if attempt < self.max_retries:
                time.sleep(2**attempt)
        raise TranslationError(f"OpenAI API request failed: {last_error}") from last_error

    def _extract_text(self, data: dict[str, Any]) -> str:
        if data.get("error"):
            raise TranslationError(f"OpenAI API error: {data['error']}")
        if data.get("output_text"):
            return str(data["output_text"])
        chunks: list[str] = []
        for output in data.get("output", []):
            for item in output.get("content", []):
                item_type = item.get("type")
                if item_type == "refusal":
                    raise TranslationError(f"OpenAI model refusal: {item.get('refusal', '')}")
                if item_type in {"output_text", "text"} and "text" in item:
                    chunks.append(str(item["text"]))
        if chunks:
            return "".join(chunks)
        raise TranslationError("OpenAI response did not contain output text")


def normalize_translation_backend(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    if normalized in {"dryrun", "dry"}:
        normalized = "dry-run"
    if normalized not in SUPPORTED_TRANSLATION_BACKENDS:
        raise TranslationError(
            "지원하지 않는 번역 백엔드입니다: "
            f"{value}. 지원값: {', '.join(sorted(SUPPORTED_TRANSLATION_BACKENDS))}"
        )
    return normalized


def result_from_payload(payload: dict[str, Any], raw_response: dict[str, Any] | None = None) -> TranslationResult:
    if not isinstance(payload, dict):
        raise TranslationError("OpenAI response JSON was not an object")
    new_term_payload = payload.get("new_terms", [])
    conflict_payload = payload.get("term_conflicts", [])
    if not isinstance(new_term_payload, list) or not isinstance(conflict_payload, list):
        raise TranslationError("OpenAI response JSON had invalid term arrays")
    new_terms = [
        GlossaryProposal(
            source=str(item.get("source", "")),
            target=str(item.get("target", "")),
            type=str(item.get("type", "unknown")),
            confidence=_confidence(item.get("confidence", 0.5)),
            reason=str(item.get("reason", "")),
            evidence_quote=str(item.get("evidence_quote", "")),
            alternative_targets=_string_list(item.get("alternative_targets", [])),
            used_in_translation=bool(item.get("used_in_translation", False)),
            proposer=str(item.get("proposer", "model")),
        )
        for item in new_term_payload
        if isinstance(item, dict)
    ]
    conflicts = [
        TermConflict(
            source=str(item.get("source", "")),
            previous=str(item.get("previous", "")),
            suggested=str(item.get("suggested", "")),
            recommendation=str(item.get("recommendation", "keep_previous")),
        )
        for item in conflict_payload
        if isinstance(item, dict)
    ]
    return TranslationResult(
        title_ko=_string_value(payload.get("title_ko", "")),
        foreword_ko=_string_value(payload.get("foreword_ko", "")),
        body_ko=_string_value(payload.get("body_ko", "")),
        afterword_ko=_string_value(payload.get("afterword_ko", "")),
        new_terms=new_terms,
        term_conflicts=conflicts,
        episode_summary=_string_value(payload.get("episode_summary", "")),
        qa_notes=[_string_value(item) for item in _list_value(payload.get("qa_notes", []))],
        raw_response=raw_response or {},
    )


def extract_translation_payload(text: str) -> dict[str, Any]:
    cleaned = _strip_ansi(text).strip()
    payload = _payload_from_possible_json_text(cleaned, depth=0)
    if payload is not None:
        return payload
    candidates = _json_object_candidates(cleaned)
    for candidate in candidates:
        payload = _payload_from_object(candidate, depth=0)
        if payload is not None:
            return payload
    if len(candidates) == 1:
        return candidates[0]
    raise TranslationError("Codex output did not contain a translation JSON object")


def _payload_from_possible_json_text(text: str, depth: int) -> dict[str, Any] | None:
    if depth > 3 or not text.strip():
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return _payload_from_object(parsed, depth=depth + 1)


def _payload_from_object(value: Any, depth: int) -> dict[str, Any] | None:
    if depth > 4:
        return None
    if isinstance(value, dict):
        if _looks_like_translation_payload(value):
            return value
        for key in ("output_text", "message", "text", "content", "final_response", "response"):
            nested = value.get(key)
            if isinstance(nested, str):
                payload = _payload_from_possible_json_text(nested, depth=depth + 1)
                if payload is not None:
                    return payload
            elif isinstance(nested, dict | list):
                payload = _payload_from_object(nested, depth=depth + 1)
                if payload is not None:
                    return payload
        for nested in value.values():
            if isinstance(nested, dict | list):
                payload = _payload_from_object(nested, depth=depth + 1)
                if payload is not None:
                    return payload
    elif isinstance(value, list):
        for item in value:
            payload = _payload_from_object(item, depth=depth + 1)
            if payload is not None:
                return payload
    return None


def _json_object_candidates(text: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    index = 0
    while index < len(text):
        start = text.find("{", index)
        if start < 0:
            break
        try:
            parsed, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            index = start + 1
            continue
        if isinstance(parsed, dict):
            candidates.append(parsed)
        index = start + max(1, end)
    return candidates


def _looks_like_translation_payload(value: dict[str, Any]) -> bool:
    return "title_ko" in value and (
        "body_ko" in value or "foreword_ko" in value or "afterword_ko" in value
    )


def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)


def _confidence(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.5


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _dry_run_text(text: str) -> str:
    if not text.strip():
        return ""
    paragraphs = [paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()]
    return "\n\n".join(f"[DRY-RUN KO] {paragraph}" for paragraph in paragraphs)


def _section_text(episode: EpisodeText, section_type: str) -> str:
    return "\n\n".join(section.text for section in episode.sections if section.type == section_type and section.text.strip())

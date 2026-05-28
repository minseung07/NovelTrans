"""User configuration and credential storage."""

from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import json
import os
import platform
import secrets
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .errors import ConfigurationError
from .utils import atomic_write_json, ensure_dir, read_json


APP_NAME = "noveltrans"
CONFIG_STRING_FIELDS = {
    "base_dir",
    "default_model",
    "default_reasoning_effort",
    "default_translation_preset",
    "default_source_mode",
    "default_episode_spec",
    "default_style",
    "default_honorific_policy",
    "default_glossary_strictness",
    "default_glossary_updates",
    "default_url_collection_mode",
    "default_permission_note",
    "watermark",
    "credential_backend",
    "openai_organization",
    "openai_project",
    "policy_update_url",
    "default_translation_backend",
    "codex_command",
}
CONFIG_FLOAT_FIELDS = {"input_price_per_million_tokens", "output_price_per_million_tokens", "default_temperature"}
CONFIG_INT_FIELDS = {"default_parallel_episodes", "codex_timeout_seconds", "default_long_episode_threshold_chars"}
CONFIG_BOOL_FIELDS = {
    "default_preserve_japanese_suffixes",
    "default_translate_author_notes",
    "default_keep_ruby_as_parentheses",
    "default_split_long_episode",
    "default_run_qa_pass",
    "default_run_term_consistency_pass",
    "default_check_missing_paragraphs",
    "default_compare_length_ratio",
    "default_include_glossary",
    "default_include_author_notes",
    "default_epub_vertical_writing",
    "show_policy_details_on_start",
    "prompt_source_mode_on_start",
    "show_new_project_review",
}
CONFIG_LIST_FIELDS = {"default_output_formats", "default_banned_terms"}
TRANSLATION_BACKENDS = {"auto", "openai", "codex", "dry-run"}
SOURCE_MODES = {"url", "file", "clipboard", "manual", "editor"}
TRANSLATION_PRESETS = {"fast", "balanced", "literary", "literal", "glossary"}
REASONING_EFFORTS = {"low", "medium", "high"}
GLOSSARY_STRICTNESS = {"low", "medium", "high", "strict"}
GLOSSARY_UPDATES = {"off", "safe", "review", "unsafe"}
URL_COLLECTION_MODES = {"auto", "user-file", "ask"}
EXPORT_FORMATS = {"txt", "epub"}
REMOVED_EXPORT_FORMATS = {"docx"}


@dataclass(slots=True)
class AppConfig:
    base_dir: str = "projects"
    default_model: str = "gpt-5.5"
    default_reasoning_effort: str = "medium"
    default_translation_preset: str = "balanced"
    default_source_mode: str = "url"
    default_episode_spec: str = "all"
    default_style: str = "korean_webnovel_balanced"
    default_honorific_policy: str = "adaptive"
    default_preserve_japanese_suffixes: bool = False
    default_translate_author_notes: bool = True
    default_keep_ruby_as_parentheses: bool = False
    default_glossary_strictness: str = "high"
    default_glossary_updates: str = "safe"
    default_temperature: float = 0.3
    default_parallel_episodes: int = 4
    default_split_long_episode: bool = False
    default_long_episode_threshold_chars: int = 20000
    default_run_qa_pass: bool = True
    default_run_term_consistency_pass: bool = True
    default_check_missing_paragraphs: bool = True
    default_compare_length_ratio: bool = True
    default_banned_terms: list[str] = field(default_factory=list)
    default_output_formats: list[str] = field(default_factory=lambda: ["txt", "epub"])
    default_include_glossary: bool = True
    default_include_author_notes: bool = True
    default_epub_vertical_writing: bool = False
    default_url_collection_mode: str = "auto"
    default_permission_note: str = "사용자가 권한 있는 개인 이용 목적임을 설정에서 확인함"
    show_policy_details_on_start: bool = False
    prompt_source_mode_on_start: bool = False
    show_new_project_review: bool = False
    watermark: str = "개인 번역본 / 재배포 금지 / 원저작권은 원작자에게 있음"
    credential_backend: str = "auto"
    openai_organization: str = ""
    openai_project: str = ""
    policy_update_url: str = ""
    default_translation_backend: str = "openai"
    codex_command: str = "codex"
    codex_timeout_seconds: int = 600
    input_price_per_million_tokens: float = 0.0
    output_price_per_million_tokens: float = 0.0


class ConfigManager:
    def __init__(self, config_dir: Path | None = None) -> None:
        env_dir = os.environ.get("NOVELTRANS_CONFIG_DIR")
        if config_dir is not None:
            self.config_dir = config_dir
        elif env_dir:
            self.config_dir = Path(env_dir).expanduser()
        else:
            self.config_dir = Path.home() / ".config" / APP_NAME
        self.config_path = self.config_dir / "config.json"

    def load(self) -> AppConfig:
        try:
            data = read_json(self.config_path, default=None)
        except json.JSONDecodeError as exc:
            raise ConfigurationError("Malformed config file") from exc
        if data is None:
            data = {}
        if not isinstance(data, dict):
            raise ConfigurationError("Malformed config file")
        default = AppConfig()
        values = asdict(default)
        values.update({key: value for key, value in data.items() if key in values})
        return _config_from_values(values)

    def save(self, config: AppConfig) -> None:
        ensure_dir(self.config_dir)
        atomic_write_json(self.config_path, asdict(config))


def _config_from_values(values: dict[str, Any]) -> AppConfig:
    for field in CONFIG_STRING_FIELDS:
        if not isinstance(values[field], str):
            raise ConfigurationError(f"Malformed config field {field}: expected string")
    for field in CONFIG_INT_FIELDS:
        value = values[field]
        if isinstance(value, bool) or not isinstance(value, int):
            raise ConfigurationError(f"Malformed config field {field}: expected integer")
    for field in CONFIG_BOOL_FIELDS:
        if not isinstance(values[field], bool):
            raise ConfigurationError(f"Malformed config field {field}: expected boolean")
    for field in CONFIG_LIST_FIELDS:
        value = values[field]
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ConfigurationError(f"Malformed config field {field}: expected string list")
    if not 1 <= values["default_parallel_episodes"] <= 8:
        raise ConfigurationError("Malformed config field default_parallel_episodes: expected 1-8")
    if not 30 <= values["codex_timeout_seconds"] <= 7200:
        raise ConfigurationError("Malformed config field codex_timeout_seconds: expected 30-7200")
    if not 1000 <= values["default_long_episode_threshold_chars"] <= 200000:
        raise ConfigurationError("Malformed config field default_long_episode_threshold_chars: expected 1000-200000")
    values["default_translation_backend"] = _normalize_backend(values["default_translation_backend"])
    if values["default_source_mode"] not in SOURCE_MODES:
        raise ConfigurationError("Malformed config field default_source_mode")
    if values["default_translation_preset"] not in TRANSLATION_PRESETS:
        raise ConfigurationError("Malformed config field default_translation_preset")
    if values["default_reasoning_effort"] not in REASONING_EFFORTS:
        raise ConfigurationError("Malformed config field default_reasoning_effort")
    if values["default_glossary_strictness"] not in GLOSSARY_STRICTNESS:
        raise ConfigurationError("Malformed config field default_glossary_strictness")
    if values["default_glossary_updates"] not in GLOSSARY_UPDATES:
        raise ConfigurationError("Malformed config field default_glossary_updates")
    if values["default_url_collection_mode"] not in URL_COLLECTION_MODES:
        raise ConfigurationError("Malformed config field default_url_collection_mode")
    output_formats = [
        item.strip().lower()
        for item in values["default_output_formats"]
        if item.strip() and item.strip().lower() not in REMOVED_EXPORT_FORMATS
    ]
    if not output_formats or set(output_formats) - EXPORT_FORMATS:
        raise ConfigurationError("Malformed config field default_output_formats")
    values["default_output_formats"] = output_formats
    values["default_banned_terms"] = [item.strip() for item in values["default_banned_terms"] if item.strip()]
    if not values["codex_command"].strip():
        raise ConfigurationError("Malformed config field codex_command: expected non-empty string")
    for field in CONFIG_FLOAT_FIELDS:
        value = values[field]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ConfigurationError(f"Malformed config field {field}: expected number")
        if value < 0:
            raise ConfigurationError(f"Malformed config field {field}: expected non-negative number")
        values[field] = float(value)
    if values["default_temperature"] > 2.0:
        raise ConfigurationError("Malformed config field default_temperature: expected 0-2")
    return AppConfig(**values)


def _normalize_backend(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    if normalized in {"dryrun", "dry"}:
        normalized = "dry-run"
    if normalized not in TRANSLATION_BACKENDS:
        raise ConfigurationError(
            "Malformed config field default_translation_backend: expected auto, openai, codex, or dry-run"
        )
    return normalized


class CredentialStore:
    """Stores API keys in keyring when available, otherwise in a local encrypted file."""

    service = "noveltrans.openai"
    username = "default"
    access_token_username = "access_token"

    def __init__(self, config_dir: Path | None = None) -> None:
        env_dir = os.environ.get("NOVELTRANS_CONFIG_DIR")
        if config_dir is not None:
            self.config_dir = config_dir
        elif env_dir:
            self.config_dir = Path(env_dir).expanduser()
        else:
            self.config_dir = Path.home() / ".config" / APP_NAME
        self.secret_path = self.config_dir / "credentials.json"
        self.access_token_path = self.config_dir / "openai_access_token.json"

    def get_api_key(self) -> str:
        env_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if _is_usable_secret(env_key):
            return env_key
        key = self._get_keyring()
        if _is_usable_secret(key):
            return key
        return _usable_or_empty(self._read_local_secret())

    def get_access_token(self) -> str:
        env_token = os.environ.get("NOVELTRANS_OPENAI_ACCESS_TOKEN", "").strip()
        if _is_usable_secret(env_token):
            return env_token
        token = self._get_keyring_secret(self.access_token_username)
        if _is_usable_secret(token):
            return token
        return _usable_or_empty(self._read_local_secret(self.access_token_path))

    def set_api_key(self, api_key: str) -> str:
        api_key = api_key.strip()
        _assert_usable_secret(api_key, "API key")
        if self._set_keyring(api_key):
            return "keyring"
        self._write_local_secret(api_key, self.secret_path)
        return "local_encrypted_file"

    def set_access_token(self, access_token: str) -> str:
        access_token = access_token.strip()
        _assert_usable_secret(access_token, "Access token")
        if self._set_keyring_secret(self.access_token_username, access_token):
            return "keyring"
        self._write_local_secret(access_token, self.access_token_path)
        return "local_encrypted_file"

    def clear_api_key(self) -> None:
        self._delete_keyring()
        if self.secret_path.exists():
            self.secret_path.unlink()

    def clear_access_token(self) -> None:
        self._delete_keyring_secret(self.access_token_username)
        if self.access_token_path.exists():
            self.access_token_path.unlink()

    def _get_keyring(self) -> str:
        return self._get_keyring_secret(self.username)

    def _get_keyring_secret(self, username: str) -> str:
        try:
            import keyring  # type: ignore

            return keyring.get_password(self.service, username) or ""
        except Exception:
            return ""

    def _set_keyring(self, api_key: str) -> bool:
        return self._set_keyring_secret(self.username, api_key)

    def _set_keyring_secret(self, username: str, secret: str) -> bool:
        try:
            import keyring  # type: ignore

            keyring.set_password(self.service, username, secret)
            return True
        except Exception:
            return False

    def _delete_keyring(self) -> None:
        self._delete_keyring_secret(self.username)

    def _delete_keyring_secret(self, username: str) -> None:
        try:
            import keyring  # type: ignore

            keyring.delete_password(self.service, username)
        except Exception:
            return

    def _machine_secret(self) -> bytes:
        raw = "|".join(
            [
                getpass.getuser(),
                str(Path.home()),
                platform.node(),
                platform.system(),
            ]
        )
        return hashlib.sha256(raw.encode("utf-8")).digest()

    def _derive_stream(self, salt: bytes, length: int) -> bytes:
        seed = hashlib.pbkdf2_hmac("sha256", self._machine_secret(), salt, 200_000, dklen=32)
        stream = bytearray()
        counter = 0
        while len(stream) < length:
            stream.extend(hmac.new(seed, counter.to_bytes(8, "big"), hashlib.sha256).digest())
            counter += 1
        return bytes(stream[:length])

    def _write_local_secret(self, secret: str, path: Path) -> None:
        ensure_dir(self.config_dir)
        salt = secrets.token_bytes(16)
        plain = secret.encode("utf-8")
        stream = self._derive_stream(salt, len(plain))
        cipher = bytes(left ^ right for left, right in zip(plain, stream))
        mac = hmac.new(self._machine_secret(), salt + cipher, hashlib.sha256).digest()
        payload = {
            "version": 1,
            "salt": base64.b64encode(salt).decode("ascii"),
            "ciphertext": base64.b64encode(cipher).decode("ascii"),
            "hmac": base64.b64encode(mac).decode("ascii"),
            "backend": "local_encrypted_file",
        }
        atomic_write_json(path, payload)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    def _read_local_secret(self, path: Path | None = None) -> str:
        path = path or self.secret_path
        try:
            data = read_json(path, default=None)
            if data is None or data == {}:
                return ""
            if not isinstance(data, dict):
                raise ConfigurationError("Malformed credentials file")
            salt = base64.b64decode(data["salt"])
            cipher = base64.b64decode(data["ciphertext"])
            expected = base64.b64decode(data["hmac"])
            actual = hmac.new(self._machine_secret(), salt + cipher, hashlib.sha256).digest()
            if not hmac.compare_digest(expected, actual):
                raise ConfigurationError("Stored credential failed integrity check")
            stream = self._derive_stream(salt, len(cipher))
            plain = bytes(left ^ right for left, right in zip(cipher, stream))
            return plain.decode("utf-8")
        except ConfigurationError:
            raise
        except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConfigurationError("Malformed credentials file") from exc


def _assert_usable_secret(secret: str, label: str) -> None:
    if not secret:
        raise ConfigurationError(f"{label} cannot be empty")
    if not _is_usable_secret(secret):
        raise ConfigurationError(f"{label} looks malformed")


def _usable_or_empty(secret: str) -> str:
    return secret if _is_usable_secret(secret) else ""


def _is_usable_secret(secret: str) -> bool:
    secret = secret.strip()
    if len(secret) < 3:
        return False
    return any(char.isalnum() for char in secret)

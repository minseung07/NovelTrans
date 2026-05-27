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
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .errors import ConfigurationError
from .utils import atomic_write_json, ensure_dir, read_json


APP_NAME = "noveltrans"
CONFIG_STRING_FIELDS = {
    "base_dir",
    "default_model",
    "default_reasoning_effort",
    "watermark",
    "credential_backend",
    "openai_organization",
    "openai_project",
    "policy_update_url",
    "default_translation_backend",
    "codex_command",
}
CONFIG_FLOAT_FIELDS = {"input_price_per_million_tokens", "output_price_per_million_tokens"}
CONFIG_INT_FIELDS = {"default_parallel_episodes", "codex_timeout_seconds"}
TRANSLATION_BACKENDS = {"auto", "openai", "codex", "dry-run"}


@dataclass(slots=True)
class AppConfig:
    base_dir: str = "projects"
    default_model: str = "gpt-5.5"
    default_reasoning_effort: str = "medium"
    default_parallel_episodes: int = 4
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
    if not 1 <= values["default_parallel_episodes"] <= 8:
        raise ConfigurationError("Malformed config field default_parallel_episodes: expected 1-8")
    if not 30 <= values["codex_timeout_seconds"] <= 7200:
        raise ConfigurationError("Malformed config field codex_timeout_seconds: expected 30-7200")
    values["default_translation_backend"] = _normalize_backend(values["default_translation_backend"])
    if not values["codex_command"].strip():
        raise ConfigurationError("Malformed config field codex_command: expected non-empty string")
    for field in CONFIG_FLOAT_FIELDS:
        value = values[field]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ConfigurationError(f"Malformed config field {field}: expected number")
        if value < 0:
            raise ConfigurationError(f"Malformed config field {field}: expected non-negative number")
        values[field] = float(value)
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
        if env_key:
            return env_key
        key = self._get_keyring()
        if key:
            return key
        return self._read_local_secret()

    def get_access_token(self) -> str:
        env_token = os.environ.get("NOVELTRANS_OPENAI_ACCESS_TOKEN", "").strip()
        if env_token:
            return env_token
        token = self._get_keyring_secret(self.access_token_username)
        if token:
            return token
        return self._read_local_secret(self.access_token_path)

    def set_api_key(self, api_key: str) -> str:
        api_key = api_key.strip()
        if not api_key:
            raise ConfigurationError("API key cannot be empty")
        if self._set_keyring(api_key):
            return "keyring"
        self._write_local_secret(api_key, self.secret_path)
        return "local_encrypted_file"

    def set_access_token(self, access_token: str) -> str:
        access_token = access_token.strip()
        if not access_token:
            raise ConfigurationError("Access token cannot be empty")
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

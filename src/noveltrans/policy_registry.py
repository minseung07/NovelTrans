"""Local policy registry and update support."""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .config import APP_NAME
from .errors import ConfigurationError
from .models import ConnectorPolicy
from .utils import atomic_write_json, ensure_dir, read_json


POLICY_FIELDS = set(ConnectorPolicy.__dataclass_fields__.keys())
POLICY_GRADES = {"A", "B", "C", "D"}
POLICY_BOOL_FIELDS = {
    "auto_fetch_allowed",
    "requires_official_api",
    "requires_user_permission",
    "supports_login",
}
POLICY_STRING_FIELDS = {"site_name", "grade", "notes"}


class PolicyRegistry:
    """Stores locally updated connector policies.

    Policies are keyed by `site_name` so built-in connectors can remain simple
    while the policy layer can be updated when site rules change.
    """

    def __init__(self, path: Path | None = None) -> None:
        env_dir = os.environ.get("NOVELTRANS_CONFIG_DIR")
        if path is not None:
            self.path = path
        elif env_dir:
            self.path = Path(env_dir).expanduser() / "policies.json"
        else:
            self.path = Path.home() / ".config" / APP_NAME / "policies.json"

    def effective_policy(self, policy: ConnectorPolicy) -> ConnectorPolicy:
        overrides = self.load().get(policy.site_name)
        if not overrides:
            return policy
        values = asdict(policy)
        values.update({key: value for key, value in overrides.items() if key in POLICY_FIELDS})
        return ConnectorPolicy(**values)

    def load(self) -> dict[str, dict[str, Any]]:
        try:
            payload = read_json(self.path, default=None)
        except json.JSONDecodeError as exc:
            raise ConfigurationError("Malformed policy registry file") from exc
        if payload is None:
            return {}
        if isinstance(payload, list):
            policies = payload
        elif isinstance(payload, dict):
            policies = payload.get("policies", payload)
        else:
            raise ConfigurationError("Malformed policy registry file")
        if isinstance(policies, list):
            result: dict[str, dict[str, Any]] = {}
            for item in policies:
                if not isinstance(item, dict) or not item.get("site_name"):
                    raise ConfigurationError("Malformed policy registry file")
                site_name, values = _validate_policy_override(str(item["site_name"]), item)
                result[site_name] = values
            return result
        if isinstance(policies, dict):
            result: dict[str, dict[str, Any]] = {}
            for key, value in policies.items():
                if not isinstance(value, dict):
                    raise ConfigurationError("Malformed policy registry file")
                site_name, values = _validate_policy_override(str(key), value)
                result[site_name] = values
            return result
        raise ConfigurationError("Malformed policy registry file")

    def save(self, policies: dict[str, dict[str, Any]]) -> None:
        ensure_dir(self.path.parent)
        atomic_write_json(self.path, {"version": 1, "policies": policies})

    def import_payload(self, payload: dict[str, Any]) -> int:
        if not isinstance(payload, dict):
            raise ConfigurationError("Malformed policy update payload")
        incoming = _extract_policies(payload)
        current = self.load()
        current.update(incoming)
        self.save(current)
        return len(incoming)

    def import_file(self, path: Path) -> int:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ConfigurationError("Malformed policy update file") from exc
        return self.import_payload(payload)

    def import_url(self, url: str, timeout: int = 30) -> int:
        if urlparse(url).scheme.lower() != "https":
            raise ConfigurationError("정책 업데이트 URL은 HTTPS만 허용됩니다.")
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "NovelTransCLI/1.0 policy-updater"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            try:
                payload = json.loads(response.read().decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ConfigurationError("Malformed policy update response") from exc
        return self.import_payload(payload)


def _extract_policies(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    policies = payload.get("policies", payload)
    result: dict[str, dict[str, Any]] = {}
    if isinstance(policies, list):
        for item in policies:
            if not isinstance(item, dict) or not item.get("site_name"):
                raise ConfigurationError("Malformed policy update payload")
            site_name, values = _validate_policy_override(str(item["site_name"]), item)
            result[site_name] = values
    elif isinstance(policies, dict):
        for key, value in policies.items():
            if not isinstance(value, dict):
                raise ConfigurationError("Malformed policy update payload")
            site_name, values = _validate_policy_override(str(key), value)
            result[site_name] = values
    else:
        raise ConfigurationError("Malformed policy update payload")
    return result


def _validate_policy_override(site_key: str, payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    values = {key: value for key, value in payload.items() if key in POLICY_FIELDS}
    site_name = str(values.get("site_name") or site_key)
    if not site_name:
        raise ConfigurationError("Malformed policy update payload")
    values["site_name"] = site_name
    for field in POLICY_BOOL_FIELDS:
        if field in values and not isinstance(values[field], bool):
            raise ConfigurationError(f"Malformed policy field {field}: expected boolean")
    for field in POLICY_STRING_FIELDS:
        if field in values and not isinstance(values[field], str):
            raise ConfigurationError(f"Malformed policy field {field}: expected string")
    if "grade" in values and values["grade"] not in POLICY_GRADES:
        raise ConfigurationError("Malformed policy field grade: expected A, B, C, or D")
    if "max_rps" in values and (
        isinstance(values["max_rps"], bool) or not isinstance(values["max_rps"], int | float)
    ):
        raise ConfigurationError("Malformed policy field max_rps: expected number")
    if "allowed_input_modes" in values:
        modes = values["allowed_input_modes"]
        if not isinstance(modes, list) or not all(isinstance(item, str) for item in modes):
            raise ConfigurationError("Malformed policy field allowed_input_modes: expected string list")
    return site_name, values

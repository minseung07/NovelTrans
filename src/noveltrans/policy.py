"""Policy engine for source connectors."""

from __future__ import annotations

from dataclasses import asdict

from .errors import PolicyViolation
from .models import ConnectorPolicy
from .policy_registry import PolicyRegistry


SAFE_POLICY_TEXT = (
    "본 도구는 저작권 침해, 유료 콘텐츠 우회, 로그인 세션 탈취, 캡차 우회, "
    "사이트 약관 위반 목적의 자동 수집을 지원하지 않는다."
)


class PolicyEngine:
    """Applies connector policies before any automated body fetch."""

    def __init__(self, registry: PolicyRegistry | None = None) -> None:
        self.registry = registry or PolicyRegistry()

    def effective_policy(self, policy: ConnectorPolicy) -> ConnectorPolicy:
        return self.registry.effective_policy(policy)

    def describe(self, policy: ConnectorPolicy) -> str:
        policy = self.effective_policy(policy)
        status = "자동 수집 허용" if policy.auto_fetch_allowed else "자동 본문 수집 금지"
        modes = ", ".join(policy.allowed_input_modes) or "none"
        lines = [
            f"{policy.site_name} / 등급 {policy.grade} / {status}",
            f"- 공식 API 필요: {'예' if policy.requires_official_api else '아니오'}",
            f"- 사용자 권한 확인 필요: {'예' if policy.requires_user_permission else '아니오'}",
            f"- 로그인 지원: {'예' if policy.supports_login else '아니오'}",
            f"- 허용 입력 방식: {modes}",
            "- 가능 작업:",
        ]
        lines.extend(f"  - {line}" for line in self.available_actions(policy))
        lines.append(f"- 메모: {policy.notes}")
        return "\n".join(lines)

    def available_actions(self, policy: ConnectorPolicy) -> list[str]:
        policy = self.effective_policy(policy)
        actions: list[str] = []
        if policy.auto_fetch_allowed:
            if "url" not in policy.allowed_input_modes:
                actions.append("사용자가 직접 제공한 TXT/HTML/ZIP 파일에서 본문 처리")
                if any(mode in policy.allowed_input_modes for mode in ("clipboard", "manual")):
                    actions.append("클립보드, 직접 입력, 외부 편집기로 제공한 원문 처리")
            elif policy.grade == "B":
                actions.append("권한/약관 근거 메모를 남긴 뒤 공개 본문 URL을 낮은 빈도로 자동 수집")
                actions.append("사용자가 직접 저장한 TXT/HTML/ZIP 또는 붙여넣기 원문 처리")
            else:
                actions.append("권한 확인 후 URL에서 본문 자동 수집")
                actions.append("사용자가 직접 저장한 TXT/HTML/ZIP 또는 붙여넣기 원문 처리")
        else:
            if "metadata_url" in policy.allowed_input_modes:
                actions.append("URL은 작품 메타데이터 확인용으로만 사용")
            actions.append("본문은 사용자가 직접 제공한 TXT/HTML/ZIP 또는 붙여넣기 원문만 처리")
        if not policy.supports_login:
            actions.append("로그인, 유료/비공개 회차, 쿠키/세션, 캡차 우회는 사용하지 않음")
        return actions

    def assert_can_auto_fetch(
        self,
        policy: ConnectorPolicy,
        user_permission: bool = False,
        permission_evidence: str = "",
    ) -> None:
        policy = self.effective_policy(policy)
        if not policy.auto_fetch_allowed:
            raise PolicyViolation(
                f"{policy.site_name} 정책상 자동 본문 수집이 비활성화되어 있습니다. "
                "사용자가 직접 저장한 TXT/HTML/ZIP 또는 붙여넣기 입력만 사용할 수 있습니다."
            )
        if policy.requires_user_permission and not user_permission:
            raise PolicyViolation(
                f"{policy.site_name} 자동 수집에는 사용자의 명시적 권한 확인이 필요합니다."
            )
        if policy.grade == "B" and not permission_evidence.strip():
            raise PolicyViolation(
                f"{policy.site_name} B 등급 자동 수집에는 약관/API/권한 근거 메모가 필요합니다."
            )

    def as_dict(self, policy: ConnectorPolicy) -> dict[str, object]:
        return asdict(self.effective_policy(policy))

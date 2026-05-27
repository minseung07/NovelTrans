"""Domain exceptions used across NovelTrans."""


class NovelTransError(Exception):
    """Base exception for user-facing NovelTrans failures."""


class PolicyViolation(NovelTransError):
    """Raised when a connector policy blocks an automated operation."""


class ConnectorNotFound(NovelTransError):
    """Raised when no connector can handle a source."""


class TranslationError(NovelTransError):
    """Raised when a translation job fails."""


class ProjectError(NovelTransError):
    """Raised for invalid project state or storage failures."""


class ConfigurationError(NovelTransError):
    """Raised for invalid configuration or credentials."""


class EpisodeRangeError(NovelTransError):
    """Raised when an episode range expression cannot be parsed."""


class SourceInputError(NovelTransError):
    """Raised when provided source text cannot produce translatable episodes."""

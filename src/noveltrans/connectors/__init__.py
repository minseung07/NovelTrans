"""Connector registry."""

from __future__ import annotations

from importlib import metadata
from pathlib import Path

from noveltrans.errors import ConnectorNotFound

from .aozora import AozoraConnector
from .base import NovelConnector
from .local_file import LocalFileConnector
from .restricted import HamelnConnector, KakuyomuConnector, PixivConnector
from .syosetu import SyosetuConnector


BUILTIN_CONNECTORS: list[NovelConnector] = [
    AozoraConnector(),
    SyosetuConnector(),
    KakuyomuConnector(),
    HamelnConnector(),
    PixivConnector(),
    LocalFileConnector(),
]


def load_plugin_connectors() -> list[NovelConnector]:
    connectors: list[NovelConnector] = []
    try:
        entry_points = metadata.entry_points(group="noveltrans.connectors")
    except TypeError:
        entry_points = metadata.entry_points().get("noveltrans.connectors", [])
    for entry_point in entry_points:
        factory = entry_point.load()
        connector = factory()
        if not isinstance(connector, NovelConnector):
            raise TypeError(f"Connector plugin {entry_point.name} does not implement NovelConnector")
        connectors.append(connector)
    return connectors


def get_connectors(include_plugins: bool = True) -> list[NovelConnector]:
    connectors = list(BUILTIN_CONNECTORS)
    if include_plugins:
        connectors.extend(load_plugin_connectors())
    return connectors


def detect_connector(source: str | Path, include_plugins: bool = True) -> NovelConnector:
    source_text = str(source)
    for connector in get_connectors(include_plugins=include_plugins):
        if connector.detect(source_text):
            return connector
    raise ConnectorNotFound(f"No connector can handle source: {source_text}")

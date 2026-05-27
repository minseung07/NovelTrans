"""TXT and EPUB exporters implemented with the standard library."""

from __future__ import annotations

import re
import uuid
import zipfile
from pathlib import Path

from .errors import ConfigurationError, ProjectError
from .glossary import GlossaryManager, is_pending_auto_seed
from .models import ProjectManifest
from .project import Project
from .utils import atomic_write_text, escape_xml, now_iso

SUPPORTED_FORMATS = {"txt", "epub"}
REMOVED_FORMATS = {"docx"}


class Exporter:
    def export(self, project: Project, formats: list[str] | None = None) -> list[Path]:
        manifest = project.load_manifest()
        requested = normalize_export_formats(formats or manifest.export.formats)
        if not read_translated_chapters(project):
            raise ProjectError("내보낼 번역 파일이 없습니다.")
        outputs: list[Path] = []
        if "txt" in requested:
            outputs.append(export_txt(project, manifest))
        if "epub" in requested:
            outputs.append(export_epub(project, manifest))
        project.db.audit("exports_generated", ",".join(path.name for path in outputs))
        return outputs


def normalize_export_formats(formats: list[str]) -> list[str]:
    requested = [item.strip().lower() for item in formats if item.strip()]
    requested = [item for item in requested if item not in REMOVED_FORMATS]
    unsupported = sorted(set(requested) - SUPPORTED_FORMATS)
    if unsupported:
        raise ConfigurationError(f"지원하지 않는 출력 형식: {', '.join(unsupported)}")
    if not requested:
        raise ConfigurationError("DOCX 출력은 제거되었습니다. txt 또는 epub 중 하나 이상을 선택하세요.")
    return requested


def read_translated_chapters(project: Project, include_author_notes: bool = True) -> list[tuple[int, str, str]]:
    chapters: list[tuple[int, str, str]] = []
    statuses = project.db.episode_statuses()
    for path in sorted(project.translated_dir.glob("episode_*.ko.md")):
        stem = path.stem.split(".")[0]
        try:
            episode_no = int(stem.split("_")[1])
        except (IndexError, ValueError):
            continue
        if statuses and statuses.get(episode_no) != "completed":
            continue
        text = path.read_text(encoding="utf-8")
        if not include_author_notes:
            text = _strip_author_note_sections(text)
        title = "Episode"
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        chapters.append((episode_no, title, text))
    return sorted(chapters, key=lambda item: item[0])


def export_txt(project: Project, manifest: ProjectManifest) -> Path:
    chapters = read_translated_chapters(project, include_author_notes=manifest.export.include_author_notes)
    lines = [
        manifest.work.title,
        f"저자: {manifest.work.author or 'unknown'}",
        f"원본: {manifest.work.source_url}",
        f"수집일: {manifest.work.collected_at}",
        f"출처/사용 조건: {manifest.work.license_note}",
        f"번역일: {now_iso()}",
        f"번역 설정: {manifest.translation.preset} / {manifest.translation.model}",
        manifest.export.watermark,
        "",
    ]
    for _, _, text in chapters:
        lines.append(text.strip())
        lines.append("")
    if manifest.export.include_glossary:
        lines.extend(_glossary_lines(project))
    output = project.exports_dir / f"{manifest.slug}.txt"
    atomic_write_text(output, "\n".join(lines).rstrip() + "\n")
    return output


def export_epub(project: Project, manifest: ProjectManifest) -> Path:
    chapters = read_translated_chapters(project, include_author_notes=manifest.export.include_author_notes)
    book_id = f"urn:uuid:{uuid.uuid4()}"
    output = project.exports_dir / f"{manifest.slug}.epub"
    style = _epub_style(vertical=manifest.export.epub_vertical_writing)
    modified = now_iso().replace("+00:00", "Z")
    with zipfile.ZipFile(output, "w") as archive:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        archive.writestr(info, "application/epub+zip")
        archive.writestr("META-INF/container.xml", _EPUB_CONTAINER, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("OEBPS/style.css", style, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("OEBPS/cover.xhtml", _epub_cover(manifest), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("OEBPS/title.xhtml", _epub_title_page(manifest), compress_type=zipfile.ZIP_DEFLATED)
        manifest_items = [
            '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
            '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
            '<item id="style" href="style.css" media-type="text/css"/>',
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ]
        spine_items = ['<itemref idref="cover"/>', '<itemref idref="title"/>']
        nav_items: list[str] = ['<li><a href="title.xhtml">작품 정보</a></li>']
        ncx_points: list[str] = []
        play_order = 1
        ncx_points.append(
            _ncx_point("title", play_order, "작품 정보", "title.xhtml")
        )
        play_order += 1
        for episode_no, title, text in chapters:
            file_name = f"chapter_{episode_no:03d}.xhtml"
            item_id = f"chapter_{episode_no:03d}"
            archive.writestr(
                f"OEBPS/{file_name}",
                _epub_chapter(item_id, title, _markdown_to_xhtml_body(text, skip_first_heading=True)),
                compress_type=zipfile.ZIP_DEFLATED,
            )
            manifest_items.append(f'<item id="{item_id}" href="{file_name}" media-type="application/xhtml+xml"/>')
            spine_items.append(f'<itemref idref="{item_id}"/>')
            nav_items.append(f'<li><a href="{file_name}">{escape_xml(title)}</a></li>')
            ncx_points.append(_ncx_point(item_id, play_order, title, file_name))
            play_order += 1
        if manifest.export.include_glossary:
            archive.writestr(
                "OEBPS/glossary.xhtml",
                _epub_chapter("glossary", "용어집", _glossary_xhtml(project), epub_type="glossary"),
                compress_type=zipfile.ZIP_DEFLATED,
            )
            manifest_items.append('<item id="glossary" href="glossary.xhtml" media-type="application/xhtml+xml"/>')
            spine_items.append('<itemref idref="glossary"/>')
            nav_items.append('<li><a href="glossary.xhtml">용어집</a></li>')
            ncx_points.append(_ncx_point("glossary", play_order, "용어집", "glossary.xhtml"))
        archive.writestr(
            "OEBPS/nav.xhtml",
            _EPUB_NAV.format(title=escape_xml(manifest.work.title), items="\n".join(nav_items)),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        archive.writestr(
            "OEBPS/toc.ncx",
            _EPUB_TOC.format(book_id=escape_xml(book_id), title=escape_xml(manifest.work.title), points="\n".join(ncx_points)),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        archive.writestr(
            "OEBPS/content.opf",
            _EPUB_OPF.format(
                book_id=escape_xml(book_id),
                title=escape_xml(manifest.work.title),
                author=escape_xml(manifest.work.author or "unknown"),
                source=escape_xml(manifest.work.source_url),
                rights=escape_xml(manifest.work.license_note or manifest.export.watermark),
                description=escape_xml(
                    f"{manifest.export.watermark} / collected_at={manifest.work.collected_at}"
                ),
                date=escape_xml((manifest.work.collected_at or modified)[:10]),
                modified=modified,
                manifest="\n".join(manifest_items),
                spine="\n".join(spine_items),
                page_progression="rtl" if manifest.export.epub_vertical_writing else "ltr",
            ),
            compress_type=zipfile.ZIP_DEFLATED,
        )
    return output


def _markdown_to_xhtml_body(text: str, skip_first_heading: bool = False) -> str:
    parts: list[str] = []
    skipped_heading = False
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        if len(lines) == 1 and lines[0].startswith("#"):
            if skip_first_heading and not skipped_heading and lines[0].startswith("# "):
                skipped_heading = True
                continue
            stripped = lines[0]
            level = len(stripped) - len(stripped.lstrip("#"))
            heading = stripped[level:].strip()
            tag = "h2" if level <= 2 else "h3"
            css_class = "section-title" if tag == "h2" else "minor-title"
            parts.append(f'<{tag} class="{css_class}">{escape_xml(heading)}</{tag}>')
            continue
        paragraph = "<br/>".join(escape_xml(line) for line in lines)
        parts.append(f"<p>{paragraph}</p>")
    return "\n".join(parts)


def _strip_author_note_sections(text: str) -> str:
    lines: list[str] = []
    skipping = False
    for line in text.splitlines():
        level, heading = _markdown_heading_info(line)
        if level >= 2 and _is_author_note_heading(heading):
            skipping = True
            continue
        if skipping and level and level <= 2:
            skipping = False
        if not skipping:
            lines.append(line)
    return "\n".join(lines).rstrip() + "\n"


def _markdown_heading_info(line: str) -> tuple[int, str]:
    stripped = line.strip()
    if not stripped.startswith("#"):
        return 0, ""
    level = len(stripped) - len(stripped.lstrip("#"))
    return level, stripped[level:].strip()


def _is_author_note_heading(heading: str) -> bool:
    normalized = heading.strip().lower().replace(" ", "")
    return normalized in {"후기", "작가후기", "후서", "afterword", "authornote", "authornotes"}


def _glossary_lines(project: Project) -> list[str]:
    manager = GlossaryManager(project.glossary_dir)
    lines = ["", "용어집"]
    entries = [entry for entry in manager.snapshot(limit=500) if not is_pending_auto_seed(entry)]
    if not entries:
        lines.append("- 확정된 용어가 아직 없습니다.")
    for entry in entries:
        lines.append(f"- {entry.source} -> {entry.target} ({entry.type}, confidence={entry.confidence:.2f})")
    return lines


def _glossary_xhtml(project: Project) -> str:
    manager = GlossaryManager(project.glossary_dir)
    entries = [entry for entry in manager.snapshot(limit=500) if not is_pending_auto_seed(entry)]
    if not entries:
        return "<p class=\"empty-note\">확정된 용어가 아직 없습니다.</p>"
    lines = ["<dl class=\"glossary-list\">"]
    for entry in entries:
        lines.append(
            f"<dt>{escape_xml(entry.source)}</dt>"
            f"<dd>{escape_xml(entry.target)} "
            f"<span class=\"term-meta\">{escape_xml(entry.type)}, {entry.confidence:.2f}</span></dd>"
        )
    lines.append("</dl>")
    return "\n".join(lines)


def _epub_cover(manifest: ProjectManifest) -> str:
    body = (
        '<section epub:type="cover" class="cover-page">'
        f'<p class="eyebrow">NovelTrans EPUB</p>'
        f"<h1>{escape_xml(manifest.work.title)}</h1>"
        f'<p class="byline">{escape_xml(manifest.work.author or "unknown")}</p>'
        f'<p class="watermark">{escape_xml(manifest.export.watermark)}</p>'
        "</section>"
    )
    return _epub_document("cover", manifest.work.title, body, body_class="cover")


def _epub_title_page(manifest: ProjectManifest) -> str:
    rows = [
        ("작품명", manifest.work.title),
        ("저자", manifest.work.author or "unknown"),
        ("원본", manifest.work.source_url),
        ("수집일", manifest.work.collected_at),
        ("출처/사용 조건", manifest.work.license_note),
        ("번역 설정", f"{manifest.translation.preset} / {manifest.translation.model}"),
        ("생성일", now_iso()),
    ]
    details = "\n".join(
        f"<dt>{escape_xml(label)}</dt><dd>{escape_xml(value)}</dd>"
        for label, value in rows
        if str(value).strip()
    )
    body = (
        '<section epub:type="titlepage" class="title-page">'
        "<h1>작품 정보</h1>"
        f"<dl>{details}</dl>"
        f'<p class="watermark">{escape_xml(manifest.export.watermark)}</p>'
        "</section>"
    )
    return _epub_document("title", "작품 정보", body)


def _epub_chapter(item_id: str, title: str, body: str, epub_type: str = "chapter") -> str:
    if "<p" not in body and "<h" not in body and "<dl" not in body:
        body = f"<p>{escape_xml(body)}</p>"
    content = (
        f'<section epub:type="{escape_xml(epub_type)}" class="{escape_xml(epub_type)}">'
        f"<h1>{escape_xml(title)}</h1>"
        f"{body}"
        "</section>"
    )
    return _epub_document(item_id, title, content)


def _epub_document(item_id: str, title: str, body: str, body_class: str = "book") -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" '
        'xml:lang="ko" lang="ko">'
        "<head>"
        '<meta charset="utf-8"/>'
        f"<title>{escape_xml(title)}</title>"
        '<link rel="stylesheet" href="style.css" type="text/css"/>'
        "</head>"
        f'<body id="{escape_xml(item_id)}" class="{escape_xml(body_class)}">{body}</body>'
        "</html>"
    )


def _ncx_point(item_id: str, play_order: int, title: str, src: str) -> str:
    return (
        f'<navPoint id="{escape_xml(item_id)}" playOrder="{play_order}">'
        f"<navLabel><text>{escape_xml(title)}</text></navLabel>"
        f'<content src="{escape_xml(src)}"/>'
        "</navPoint>"
    )


def _epub_style(vertical: bool = False) -> str:
    writing = "writing-mode: vertical-rl; text-orientation: mixed;" if vertical else ""
    return f"""html, body {{
  margin: 0;
  padding: 0;
}}
body {{
  color: #1f2328;
  background: #fffdf8;
  font-family: serif;
  line-height: 1.72;
  margin: 5%;
  {writing}
}}
h1 {{
  font-size: 1.55em;
  line-height: 1.35;
  margin: 0 0 1.6em 0;
  text-align: center;
}}
h2.section-title {{
  border-bottom: 1px solid #d8d2c4;
  font-size: 1.12em;
  margin: 2.2em 0 1em 0;
  padding-bottom: 0.35em;
}}
h3.minor-title {{
  font-size: 1em;
  margin: 1.6em 0 0.8em 0;
}}
p {{
  margin: 0 0 1em 0;
  text-indent: 1em;
}}
.cover-page, .title-page {{
  margin: 18% auto 0 auto;
  max-width: 34em;
  text-align: center;
}}
.cover-page p, .title-page p {{
  text-indent: 0;
}}
.eyebrow, .term-meta {{
  color: #6b665e;
  font-size: 0.82em;
}}
.byline {{
  margin-top: -0.8em;
}}
.watermark {{
  border-top: 1px solid #d8d2c4;
  color: #6b665e;
  font-size: 0.85em;
  margin-top: 2.5em;
  padding-top: 1em;
}}
dl {{
  margin: 1em 0;
  text-align: left;
}}
dt {{
  color: #6b665e;
  font-size: 0.86em;
  margin-top: 0.85em;
}}
dd {{
  margin: 0.15em 0 0 0;
}}
.glossary-list dt {{
  color: #1f2328;
  font-weight: bold;
}}
.empty-note {{
  color: #6b665e;
  text-indent: 0;
}}
nav ol {{
  padding-left: 1.4em;
}}
nav li {{
  margin: 0.45em 0;
}}"""

_EPUB_CONTAINER = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""

_EPUB_OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" prefix="dcterms: http://purl.org/dc/terms/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">{book_id}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>ko</dc:language>
    <dc:source>{source}</dc:source>
    <dc:rights>{rights}</dc:rights>
    <dc:description>{description}</dc:description>
    <dc:publisher>NovelTrans CLI</dc:publisher>
    <dc:date>{date}</dc:date>
    <meta property="dcterms:modified">{modified}</meta>
    <meta property="generator">NovelTrans CLI</meta>
  </metadata>
  <manifest>{manifest}</manifest>
  <spine toc="toc" page-progression-direction="{page_progression}">{spine}</spine>
</package>"""

_EPUB_NAV = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">
<head><meta charset="utf-8"/><title>{title}</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body class="nav">
<nav epub:type="toc" id="toc"><h1>목차</h1><ol>{items}</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><h2>Landmarks</h2><ol><li><a epub:type="bodymatter" href="title.xhtml">작품 정보</a></li></ol></nav>
</body>
</html>"""

_EPUB_TOC = """<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="{book_id}"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap>{points}</navMap>
</ncx>"""

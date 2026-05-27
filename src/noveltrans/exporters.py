"""TXT, DOCX, and EPUB exporters implemented with the standard library."""

from __future__ import annotations

import uuid
import zipfile
from pathlib import Path

from .errors import ConfigurationError, ProjectError
from .glossary import GlossaryManager
from .models import ProjectManifest
from .project import Project
from .utils import atomic_write_text, escape_xml, now_iso

SUPPORTED_FORMATS = {"txt", "docx", "epub"}


class Exporter:
    def export(self, project: Project, formats: list[str] | None = None) -> list[Path]:
        manifest = project.load_manifest()
        requested = normalize_export_formats(formats or manifest.export.formats)
        if not read_translated_chapters(project):
            raise ProjectError("내보낼 번역 파일이 없습니다.")
        outputs: list[Path] = []
        if "txt" in requested:
            outputs.append(export_txt(project, manifest))
        if "docx" in requested:
            outputs.append(export_docx(project, manifest))
        if "epub" in requested:
            outputs.append(export_epub(project, manifest))
        project.db.audit("exports_generated", ",".join(path.name for path in outputs))
        return outputs


def normalize_export_formats(formats: list[str]) -> list[str]:
    requested = [item.strip().lower() for item in formats if item.strip()]
    unsupported = sorted(set(requested) - SUPPORTED_FORMATS)
    if unsupported:
        raise ConfigurationError(f"지원하지 않는 출력 형식: {', '.join(unsupported)}")
    if not requested:
        raise ConfigurationError("출력 형식을 하나 이상 선택해야 합니다.")
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


def export_docx(project: Project, manifest: ProjectManifest) -> Path:
    chapters = read_translated_chapters(project, include_author_notes=manifest.export.include_author_notes)
    paragraphs: list[str] = [
        manifest.work.title,
        "",
        "작품 정보",
        f"저자: {manifest.work.author or 'unknown'}",
        f"원본: {manifest.work.source_url}",
        f"수집일: {manifest.work.collected_at}",
        f"출처/사용 조건: {manifest.work.license_note}",
        f"번역 설정: {manifest.translation.preset} / {manifest.translation.model}",
        manifest.export.watermark,
        "",
        "목차",
    ]
    paragraphs.extend(f"{episode_no}. {title}" for episode_no, title, _ in chapters)
    paragraphs.extend(["", "본문"])
    for _, title, text in chapters:
        paragraphs.append(title)
        paragraphs.extend(_markdown_to_paragraphs(text, skip_first_heading=True))
    if manifest.export.include_glossary:
        paragraphs.extend(_glossary_lines(project))
    document_xml = _docx_document_xml(paragraphs)
    output = project.exports_dir / f"{manifest.slug}.docx"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _DOCX_CONTENT_TYPES)
        archive.writestr("_rels/.rels", _DOCX_RELS)
        archive.writestr("docProps/core.xml", _docx_core_xml(manifest.work.title))
        archive.writestr("word/document.xml", document_xml)
        archive.writestr("word/styles.xml", _DOCX_STYLES)
    return output


def export_epub(project: Project, manifest: ProjectManifest) -> Path:
    chapters = read_translated_chapters(project, include_author_notes=manifest.export.include_author_notes)
    book_id = f"urn:uuid:{uuid.uuid4()}"
    output = project.exports_dir / f"{manifest.slug}.epub"
    style = _epub_style(vertical=manifest.export.epub_vertical_writing)
    with zipfile.ZipFile(output, "w") as archive:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        archive.writestr(info, "application/epub+zip")
        archive.writestr("META-INF/container.xml", _EPUB_CONTAINER, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("OEBPS/style.css", style, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("OEBPS/cover.xhtml", _epub_chapter("cover", manifest.work.title, manifest.export.watermark), compress_type=zipfile.ZIP_DEFLATED)
        manifest_items = [
            '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
            '<item id="style" href="style.css" media-type="text/css"/>',
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ]
        spine_items = ['<itemref idref="cover"/>']
        nav_items: list[str] = []
        ncx_points: list[str] = []
        play_order = 1
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
            ncx_points.append(
                f'<navPoint id="{item_id}" playOrder="{play_order}"><navLabel><text>{escape_xml(title)}</text></navLabel><content src="{file_name}"/></navPoint>'
            )
            play_order += 1
        if manifest.export.include_glossary:
            archive.writestr(
                "OEBPS/glossary.xhtml",
                _epub_chapter("glossary", "용어집", _glossary_xhtml(project)),
                compress_type=zipfile.ZIP_DEFLATED,
            )
            manifest_items.append('<item id="glossary" href="glossary.xhtml" media-type="application/xhtml+xml"/>')
            spine_items.append('<itemref idref="glossary"/>')
            nav_items.append('<li><a href="glossary.xhtml">용어집</a></li>')
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
                modified=now_iso().replace("+00:00", "Z"),
                manifest="\n".join(manifest_items),
                spine="\n".join(spine_items),
            ),
            compress_type=zipfile.ZIP_DEFLATED,
        )
    return output


def _markdown_to_paragraphs(text: str, skip_first_heading: bool = False) -> list[str]:
    paragraphs: list[str] = []
    skipped_heading = False
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            if skip_first_heading and not skipped_heading and stripped.startswith("# "):
                skipped_heading = True
                continue
            stripped = stripped.lstrip("#").strip()
        paragraphs.append(stripped)
    return paragraphs


def _markdown_to_xhtml_body(text: str, skip_first_heading: bool = False) -> str:
    parts = []
    skipped_heading = False
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            if skip_first_heading and not skipped_heading and stripped.startswith("# "):
                skipped_heading = True
                continue
            level = len(stripped) - len(stripped.lstrip("#"))
            heading = stripped[level:].strip()
            tag = "h2" if level <= 2 else "h3"
            parts.append(f"<{tag}>{escape_xml(heading)}</{tag}>")
            continue
        parts.append(f"<p>{escape_xml(stripped)}</p>")
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
    for entry in manager.snapshot(limit=500):
        lines.append(f"- {entry.source} -> {entry.target} ({entry.type}, confidence={entry.confidence:.2f})")
    return lines


def _glossary_xhtml(project: Project) -> str:
    lines = ["<h1>용어집</h1>"]
    manager = GlossaryManager(project.glossary_dir)
    for entry in manager.snapshot(limit=500):
        lines.append(
            f"<p><b>{escape_xml(entry.source)}</b> -> {escape_xml(entry.target)} "
            f"({escape_xml(entry.type)}, {entry.confidence:.2f})</p>"
        )
    return "\n".join(lines)


def _docx_document_xml(paragraphs: list[str]) -> str:
    body = []
    for paragraph in paragraphs:
        body.append(
            "<w:p><w:r><w:t xml:space=\"preserve\">"
            + escape_xml(paragraph)
            + "</w:t></w:r></w:p>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(body)}<w:sectPr/></w:body></w:document>"
    )


def _docx_core_xml(title: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{escape_xml(title)}</dc:title>"
        "<dc:creator>NovelTrans CLI</dc:creator>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now_iso()}</dcterms:created>'
        "</cp:coreProperties>"
    )


def _epub_chapter(item_id: str, title: str, body: str) -> str:
    if "<p>" not in body and "<h" not in body:
        body = f"<p>{escape_xml(body)}</p>"
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml">'
        f"<head><title>{escape_xml(title)}</title><link rel=\"stylesheet\" href=\"style.css\" type=\"text/css\"/></head>"
        f'<body id="{escape_xml(item_id)}"><h1>{escape_xml(title)}</h1>{body}</body></html>'
    )


def _epub_style(vertical: bool = False) -> str:
    writing = "writing-mode: vertical-rl;" if vertical else ""
    return f"body {{ font-family: serif; line-height: 1.7; margin: 5%; {writing} }} p {{ margin: 0 0 1em 0; }}"


_DOCX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

_DOCX_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

_DOCX_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>"""

_EPUB_CONTAINER = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""

_EPUB_OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">{book_id}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:source>{source}</dc:source>
    <dc:rights>{rights}</dc:rights>
    <dc:description>{description}</dc:description>
    <meta property="dcterms:modified">{modified}</meta>
  </metadata>
  <manifest>{manifest}</manifest>
  <spine toc="toc">{spine}</spine>
</package>"""

_EPUB_NAV = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{title}</title></head>
<body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>{title}</h1><ol>{items}</ol></nav></body>
</html>"""

_EPUB_TOC = """<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="{book_id}"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap>{points}</navMap>
</ncx>"""

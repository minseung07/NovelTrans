import { basename, extname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { ensureDir } from "../storage/jsonFile.js";
import { projectPaths } from "../storage/projectPaths.js";
import { slugify } from "../utils/path.js";
import { escapeXml } from "../utils/text.js";
import { createStoredZip } from "./zip.js";
export async function exportEpub(metadata, episodes, translations, glossary) {
    const translatedEpisodes = episodes
        .map((episode) => ({ episode, translation: translations.get(episode.id) }))
        .filter((item) => Boolean(item.translation));
    const cover = metadata.outputOptions.coverImagePath ? await loadCoverImage(metadata.outputOptions.coverImagePath) : null;
    const entries = [
        { name: "mimetype", data: Buffer.from("application/epub+zip", "utf8") },
        { name: "META-INF/container.xml", data: Buffer.from(containerXml(), "utf8") },
        { name: "OEBPS/content.opf", data: Buffer.from(contentOpf(metadata, translatedEpisodes, glossary, cover), "utf8") },
        { name: "OEBPS/nav.xhtml", data: Buffer.from(navXhtml(metadata, translatedEpisodes), "utf8") },
        ...translatedEpisodes.map(({ episode, translation }) => ({
            name: `OEBPS/chapters/${episode.id}.xhtml`,
            data: Buffer.from(chapterXhtml(metadata, translation), "utf8")
        }))
    ];
    if (cover) {
        entries.push({ name: `OEBPS/images/${cover.fileName}`, data: cover.data }, { name: "OEBPS/cover.xhtml", data: Buffer.from(coverXhtml(metadata, cover.fileName), "utf8") });
    }
    if (metadata.outputOptions.includeGlossaryAppendix) {
        entries.push({
            name: "OEBPS/glossary.xhtml",
            data: Buffer.from(glossaryXhtml(metadata, glossary), "utf8")
        });
    }
    const epub = createStoredZip(entries);
    const outputPath = join(projectPaths(metadata.projectDir).exportsDir, `${slugify(metadata.name)}.epub`);
    await ensureDir(projectPaths(metadata.projectDir).exportsDir);
    await writeFile(outputPath, epub);
    return outputPath;
}
function containerXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}
function contentOpf(metadata, translatedEpisodes, glossary, cover) {
    const manifestItems = translatedEpisodes
        .map(({ episode }) => `<item id="${episode.id}" href="chapters/${episode.id}.xhtml" media-type="application/xhtml+xml"/>`)
        .join("\n    ");
    const spineItems = translatedEpisodes.map(({ episode }) => `<itemref idref="${episode.id}"/>`).join("\n    ");
    const glossaryItem = metadata.outputOptions.includeGlossaryAppendix
        ? `<item id="glossary" href="glossary.xhtml" media-type="application/xhtml+xml"/>`
        : "";
    const glossarySpine = metadata.outputOptions.includeGlossaryAppendix && glossary.entries.length > 0 ? `<itemref idref="glossary"/>` : "";
    const coverItems = cover
        ? `<item id="cover-image" href="images/${escapeXml(cover.fileName)}" media-type="${cover.mediaType}" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`
        : "";
    const coverSpine = cover ? `<itemref idref="cover" linear="no"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(metadata.id)}</dc:identifier>
    <dc:title>${escapeXml(metadata.name)}</dc:title>
    <dc:language>ko</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${coverItems}
    ${manifestItems}
    ${glossaryItem}
  </manifest>
  <spine>
    ${coverSpine}
    ${spineItems}
    ${glossarySpine}
  </spine>
</package>`;
}
function navXhtml(metadata, translatedEpisodes) {
    const items = translatedEpisodes
        .map(({ episode, translation }) => `<li><a href="chapters/${episode.id}.xhtml">${escapeXml(translation.titleKo)}</a></li>`)
        .join("\n      ");
    return xhtmlDocument(metadata.name, `<nav epub:type="toc" id="toc"><h1>${escapeXml(metadata.name)}</h1><ol>${items}</ol></nav>`, Boolean(metadata.outputOptions.verticalWriting));
}
function chapterXhtml(metadata, translation) {
    const foreword = translation.forewordKo?.trim()
        ? `<section class="foreword"><h2>Foreword</h2>${paragraphsXhtml(translation.forewordKo)}</section>`
        : "";
    const paragraphs = paragraphsXhtml(translation.bodyKo);
    const afterword = metadata.outputOptions.includeAfterword && translation.afterwordKo?.trim()
        ? `<section class="afterword"><h2>Afterword</h2>${paragraphsXhtml(translation.afterwordKo)}</section>`
        : "";
    return xhtmlDocument(translation.titleKo, `<h1>${escapeXml(translation.titleKo)}</h1>${foreword}${paragraphs}${afterword}`, Boolean(metadata.outputOptions.verticalWriting));
}
function glossaryXhtml(metadata, glossary) {
    const items = glossary.entries
        .filter((entry) => entry.target)
        .map((entry) => `<li>${escapeXml(entry.source)} → ${escapeXml(entry.target ?? "")}</li>`)
        .join("\n");
    return xhtmlDocument("Glossary", `<h1>Glossary</h1><ul>${items}</ul>`, Boolean(metadata.outputOptions.verticalWriting));
}
function coverXhtml(metadata, fileName) {
    return xhtmlDocument(`${metadata.name} Cover`, `<section epub:type="cover"><h1>${escapeXml(metadata.name)}</h1><img src="images/${escapeXml(fileName)}" alt="${escapeXml(metadata.name)} cover"/></section>`, false);
}
function xhtmlDocument(title, body, verticalWriting) {
    const writingStyle = verticalWriting ? "writing-mode:vertical-rl;text-orientation:mixed;" : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ko">
<head>
  <title>${escapeXml(title)}</title>
  <meta charset="utf-8"/>
  <style>body{font-family:serif;line-height:1.8;margin:5%;${writingStyle}} h1{font-size:1.4em;}</style>
</head>
<body>${body}</body>
</html>`;
}
function paragraphsXhtml(text) {
    return text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, "<br/>")}</p>`)
        .join("\n");
}
async function loadCoverImage(path) {
    const extension = extname(path).toLowerCase();
    const mediaType = mediaTypeForExtension(extension);
    if (!mediaType) {
        throw new Error(`Unsupported cover image type: ${extension || basename(path)}`);
    }
    return {
        fileName: `cover${extension}`,
        mediaType,
        data: await readFile(path)
    };
}
function mediaTypeForExtension(extension) {
    if (extension === ".jpg" || extension === ".jpeg") {
        return "image/jpeg";
    }
    if (extension === ".png") {
        return "image/png";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    return null;
}

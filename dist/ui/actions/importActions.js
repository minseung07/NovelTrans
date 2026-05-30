import { createProjectFromText, createProjectFromTxt } from "../../engine/projectWorkflow.js";
import { WebImportService } from "../../webImport/webImportService.js";
export const isWebImportSource = (value) => /^https?:\/\//i.test(value.trim());
export const looksLikeTextPath = (value) => /\.txt$/i.test(value.trim()) || /^[./~]/.test(value.trim());
function importBaseOptions(config, projectRoot) {
    return {
        projectRoot,
        backend: config.defaultBackend,
        translationStyle: config.translationStyle,
        concurrency: config.concurrency,
        glossaryStrictness: config.glossaryStrictness,
        qaOptions: config.qa,
        outputOptions: {
            formats: config.outputFormats,
            includeGlossaryAppendix: config.epub.includeGlossaryAppendix,
            includeAfterword: config.epub.includeAfterword,
            verticalWriting: config.epub.verticalWriting
        }
    };
}
export async function importSourceForUi(sourceValue, config, projectRoot, options = {}) {
    const source = sourceValue.trim();
    if (!source) {
        return "가져올 원문이 없습니다.";
    }
    const base = importBaseOptions(config, projectRoot);
    if (isWebImportSource(source)) {
        const request = parseWebImportRequest(source, options.webImport);
        if (!request.episodes) {
            return "웹 가져오기는 화수 범위가 필요합니다. 화수 옵션에서 1-10, latest-5, all 중 하나를 입력하세요.";
        }
        const service = options.webImportService ?? new WebImportService();
        const work = await service.loadWork(request.url);
        const preview = service.buildPreview(work, request.episodes);
        const imported = await service.importProject(preview, { ...base, userConfirmedRights: true });
        return `웹 프로젝트 생성: ${imported.created.metadata.name} (${imported.created.analysis.episodeCount}화)`;
    }
    const created = looksLikeTextPath(source)
        ? await createProjectFromTxt({ ...base, sourcePath: source })
        : await createProjectFromText({ ...base, sourceText: source, sourceLabel: "inline://noveltrans" });
    return `프로젝트 생성: ${created.metadata.name} (${created.analysis.episodeCount}화)`;
}
export function parseWebImportRequest(source, options = {}) {
    const [url = source, ...tokens] = splitImportArgs(source);
    let episodes;
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "--episodes" || token === "episodes") {
            episodes = tokens[index + 1];
            index += 1;
        }
        else if (token.startsWith("--episodes=")) {
            episodes = token.slice("--episodes=".length);
        }
        else if (token.startsWith("episodes=")) {
            episodes = token.slice("episodes=".length);
        }
    }
    return {
        url,
        episodes: options.episodes?.trim() || episodes
    };
}
function splitImportArgs(source) {
    return (source.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ""));
}

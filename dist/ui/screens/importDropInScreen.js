export function renderImportDropInPrompt(projectRoot) {
    return [
        "새 작품 가져오기",
        "",
        "원문 파일 경로 또는 지원 사이트 URL을 붙여넣으세요.",
        "지원 URL: 카쿠요무, 소설가가 되자",
        "본문을 직접 붙여넣으려면 :paste 를 입력한 뒤 EOF 한 줄로 마칩니다.",
        "TXT 파일을 분석한 뒤 추천 번역 레시피로 프로젝트를 만듭니다.",
        "",
        `Project root: ${projectRoot}`,
        "",
        "> "
    ].join("\n");
}
export function renderImportAnalysis(analysis, recipe) {
    return [
        "원문 분석 완료",
        "",
        `제목 추정: ${analysis.titleGuess}`,
        `화수: ${analysis.episodeCount}`,
        `총 글자 수: ${analysis.characterCount}`,
        `언어: ${analysis.languageGuess}`,
        `구조: ${analysis.hasEpisodeHeadings ? "화 제목 감지됨" : "단일 화 또는 제목 미감지"}`,
        `위험 요소: ${analysis.warnings.length > 0 ? analysis.warnings.join(", ") : "없음"}`,
        "",
        "추천 번역 레시피:",
        recipe,
        "",
        "[Enter] 이대로 시작   [E] 레시피 수정   [G] 먼저 용어집 훑기   [Q] 취소"
    ].join("\n");
}

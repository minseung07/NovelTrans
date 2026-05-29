export class WebHttpClient {
    lastRequestAt = 0;
    fetchFn;
    userAgent;
    timeoutMs;
    delayMs;
    constructor(options = {}) {
        this.fetchFn = options.fetchFn ?? fetch;
        this.userAgent = options.userAgent ?? "NovelTrans/0.1 (+personal import)";
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.delayMs = options.delayMs ?? 1500;
    }
    async getText(url) {
        await this.waitForRateLimit();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchFn(url, {
                signal: controller.signal,
                headers: {
                    "user-agent": this.userAgent,
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            });
            if (response.status === 403 || response.status === 401) {
                throw new Error(`접근이 차단됐습니다 (${response.status}). 로그인/유료/차단 페이지는 지원하지 않습니다.`);
            }
            if (response.status === 429) {
                throw new Error("요청이 너무 많아 차단됐습니다 (429). 잠시 후 더 작은 범위로 다시 시도하세요.");
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            return await response.text();
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async waitForRateLimit() {
        const now = Date.now();
        const elapsed = now - this.lastRequestAt;
        const waitMs = Math.max(0, this.delayMs - elapsed);
        if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        this.lastRequestAt = Date.now();
    }
}

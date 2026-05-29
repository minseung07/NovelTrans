import { nowIso } from "../../utils/time.js";
import { parseTranslationResponse } from "./translationResponse.js";
export class OpenAICompatibleAdapter {
    id = "openai-compatible";
    label = "OpenAI-compatible translator";
    options;
    constructor(options) {
        this.options = options;
    }
    async checkAvailability() {
        if (!this.options.apiKey) {
            return {
                available: false,
                message: "OPENAI_API_KEY is not set."
            };
        }
        if (!this.options.model) {
            return {
                available: false,
                message: "OpenAI-compatible model is not configured."
            };
        }
        return {
            available: true,
            message: "OpenAI-compatible backend has required local configuration."
        };
    }
    async translateEpisode(input) {
        const status = await this.checkAvailability();
        if (!status.available) {
            throw new Error(status.message);
        }
        const model = input.model || this.options.model;
        const json = await this.postChatCompletion(input, model);
        const content = json.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("OpenAI-compatible response did not contain translated content.");
        }
        const parsed = parseTranslationResponse(content, input.episode.title);
        return {
            episodeId: input.episode.id,
            titleKo: parsed.titleKo,
            bodyKo: parsed.bodyKo,
            usedGlossaryEntries: input.glossaryEntries.filter((entry) => entry.target && input.episode.sourceText.includes(entry.source)).map((entry) => entry.id),
            newGlossaryCandidates: parsed.newGlossaryCandidates,
            qaIssueIds: [],
            model,
            backend: this.id,
            createdAt: nowIso()
        };
    }
    async postChatCompletion(input, model) {
        const requestBody = renderRequestBody(input, this.options, model);
        const maxRetries = this.options.maxRetries ?? 2;
        const retryDelayMs = this.options.retryDelayMs ?? 500;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            try {
                const response = await fetchWithTimeout(`${trimTrailingSlash(this.options.baseUrl)}/chat/completions`, requestBody, this.options, input.signal);
                if (response.ok) {
                    return (await response.json());
                }
                const text = await response.text();
                const error = new Error(`OpenAI-compatible request failed with ${response.status}: ${text.slice(0, 500)}`);
                lastError = error;
                if (!isRetryableStatus(response.status) || attempt === maxRetries) {
                    throw error;
                }
            }
            catch (error) {
                lastError = error;
                if (input.signal?.aborted) {
                    throw error;
                }
                if (!isRetryableError(error) || attempt === maxRetries) {
                    throw error;
                }
            }
            await sleep(retryDelayMs * (attempt + 1), input.signal);
        }
        throw lastError ?? new Error("OpenAI-compatible request failed.");
    }
}
function renderRequestBody(input, options, model) {
    const requestBody = {
        model,
        temperature: options.temperature,
        messages: [
            {
                role: "system",
                content: "You translate Japanese web novel episodes into natural Korean. Preserve paragraph boundaries and important numbers. Apply the glossary exactly when a locked term is provided. Return only strict JSON."
            },
            {
                role: "user",
                content: renderPrompt(input)
            }
        ]
    };
    if (options.reasoningEffort) {
        requestBody.reasoning_effort = options.reasoningEffort;
    }
    return requestBody;
}
async function fetchWithTimeout(url, requestBody, options, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
        return await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${options.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
    }
    finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
    }
}
function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
function isRetryableError(error) {
    if (error instanceof Error && error.name === "AbortError") {
        return true;
    }
    return error instanceof TypeError;
}
async function sleep(ms, signal) {
    if (ms <= 0) {
        return;
    }
    if (signal?.aborted) {
        throw abortError();
    }
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            cleanup();
            reject(abortError());
        };
        const cleanup = () => {
            signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function abortError() {
    const error = new Error("OpenAI-compatible translation was cancelled.");
    error.name = "AbortError";
    return error;
}
function renderPrompt(input) {
    const glossary = input.glossaryContext ? `\nGlossary:\n${input.glossaryContext}\n` : "";
    const style = input.styleGuide ? `\nTranslation style:\n${input.styleGuide}\n` : "";
    return [
        `Episode title: ${input.episode.title}`,
        style,
        glossary,
        "Translate the title and source text into Korean.",
        "Return only this JSON shape: {\"titleKo\":\"...\",\"bodyKo\":\"...\",\"newGlossaryCandidates\":[\"source => target\"]}.",
        "Use original Japanese source terms on the left and Korean translation candidates on the right. Use an empty array when there are no new glossary candidates.",
        "",
        input.episode.body
    ].join("\n");
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/g, "");
}

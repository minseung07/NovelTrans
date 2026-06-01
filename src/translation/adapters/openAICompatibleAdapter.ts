import type { AdapterStatus, TranslationInput, TranslationResult, TranslatorAdapter } from "../../domain/translation.js";
import { nowIso } from "../../utils/time.js";
import { parseTranslationResponse } from "./translationResponse.js";

type OpenAICompatibleAdapterOptions = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  timeoutMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class OpenAICompatibleAdapter implements TranslatorAdapter {
  readonly id = "openai-compatible";
  readonly label = "OpenAI-compatible translator";
  private readonly options: OpenAICompatibleAdapterOptions;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.options = options;
  }

  async checkAvailability(): Promise<AdapterStatus> {
    if (!this.options.apiKey) {
      return {
        available: false,
        message: "OPENAI_API_KEY가 설정되지 않았습니다."
      };
    }
    const baseUrlError = validateHttpsBaseUrl(this.options.baseUrl);
    if (baseUrlError) {
      return {
        available: false,
        message: baseUrlError
      };
    }
    if (!this.options.model) {
      return {
        available: false,
        message: "OpenAI 호환 모델이 설정되지 않았습니다."
      };
    }
    return {
      available: true,
      message: "OpenAI 호환 백엔드의 로컬 설정이 갖춰졌습니다."
    };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    const status = await this.checkAvailability();
    if (!status.available) {
      throw new Error(status.message);
    }

    const model = input.model || this.options.model;
    const json = await this.postChatCompletion(input, model);
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenAI 호환 응답에 번역 결과가 없습니다.");
    }
    const parsed = parseTranslationResponse(content, input.episode.title, { strict: true });

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

  private async postChatCompletion(input: TranslationInput, model: string): Promise<ChatCompletionResponse> {
    const requestBody = renderRequestBody(input, this.options, model);
    const maxRetries = this.options.maxRetries ?? 2;
    const retryDelayMs = this.options.retryDelayMs ?? 500;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${trimTrailingSlash(this.options.baseUrl)}/chat/completions`, requestBody, this.options, input.signal);
        if (response.ok) {
          return (await response.json()) as ChatCompletionResponse;
        }
        const text = await response.text();
        const error = new Error(`OpenAI 호환 요청이 실패했습니다 (${response.status}): ${text.slice(0, 500)}`);
        lastError = error;
        if (!isRetryableStatus(response.status) || attempt === maxRetries) {
          throw error;
        }
      } catch (error) {
        lastError = error as Error;
        if (input.signal?.aborted) {
          throw error;
        }
        if (!isRetryableError(error) || attempt === maxRetries) {
          throw error;
        }
      }
      await sleep(retryDelayMs * (attempt + 1), input.signal);
    }

    throw lastError ?? new Error("OpenAI 호환 요청이 실패했습니다.");
  }
}

function renderRequestBody(input: TranslationInput, options: OpenAICompatibleAdapterOptions, model: string): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model,
    temperature: options.temperature,
    messages: [
      {
        role: "system",
        content:
          "You translate Japanese web novel episodes into natural Korean. Preserve paragraph boundaries and important numbers. Apply the glossary exactly when a locked term is provided. Return only strict JSON."
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

async function fetchWithTimeout(url: string, requestBody: Record<string, unknown>, options: OpenAICompatibleAdapterOptions, signal?: AbortSignal): Promise<Response> {
  const baseUrlError = validateHttpsBaseUrl(url);
  if (baseUrlError) {
    throw new Error(baseUrlError);
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
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
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      throw timeoutError(options.timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }
  return error instanceof TypeError;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
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

function abortError(): Error {
  const error = new Error("OpenAI 호환 번역이 취소되었습니다.");
  error.name = "AbortError";
  return error;
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`OpenAI 호환 요청이 ${timeoutMs}ms 후 시간 초과되었습니다.`);
  error.name = "TimeoutError";
  return error;
}

function renderPrompt(input: TranslationInput): string {
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function validateHttpsBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "OpenAI 호환 base URL이 올바른 URL이 아닙니다.";
  }
  if (url.protocol !== "https:") {
    return "OpenAI 호환 base URL은 bearer 토큰 보호를 위해 https를 사용해야 합니다.";
  }
  return null;
}

export interface NSLSolverConfig {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface TurnstileParams {
  siteKey: string;
  url: string;
  action?: string;
  cdata?: string;
  proxy?: string;
  userAgent?: string;
}

export interface ChallengeParams {
  url: string;
  /** Proxy is required for challenge solves. Format: `protocol://user:pass@host:port` */
  proxy: string;
  userAgent?: string;
}

export interface KasadaConfig {
  pJsPath: string;
  fpHost: string;
  tlHost: string;
  cdConstant?: string;
}

export interface KasadaParams {
  url: string;
  userAgent: string;
  uaVersion: number;
  kasadaConfig: KasadaConfig;
  proxy?: string;
}

export interface AkamaiParams {
  url: string;
  /** Akamai fingerprints UA — replay with the same value you submit. */
  userAgent: string;
  /** Proxy is required. The `_abck` cookie is bound to this proxy's egress IP. */
  proxy: string;
}

export interface RecaptchaV3Params {
  siteKey: string;
  url: string;
  /** Proxy is required for reCAPTCHA v3 solves. Format: `protocol://user:pass@host:port` */
  proxy: string;
  /** reCAPTCHA action name. Server defaults to `verify` when omitted. */
  action?: string;
  /** Set to `true` to solve against reCAPTCHA Enterprise. */
  enterprise?: boolean;
  userAgent?: string;
}

export interface TurnstileResult {
  token: string;
  /** USD deducted from the account balance for this solve. */
  cost: number;
  type: "turnstile";
}

export interface ChallengeResult {
  cookies: {
    cf_clearance: string;
    [key: string]: string;
  };
  userAgent: string;
  /** Some challenge pages return a Turnstile-style token alongside the cookies. */
  token?: string;
  /** USD deducted from the account balance for this solve. */
  cost: number;
  type: "challenge";
}

export interface KasadaResult {
  headers: {
    "x-kpsdk-ct": string;
    "x-kpsdk-cd": string;
    "x-kpsdk-v": string;
    "x-kpsdk-h": string;
  };
  /** USD deducted from the account balance for this solve. */
  cost: number;
  type: "kasada";
}

export interface AkamaiResult {
  /** Cookie jar including `_abck`. Replay on the same UA + proxy/exit IP. */
  cookies: {
    _abck?: string;
    bm_sz?: string;
    ak_bmsc?: string;
    [key: string]: string | undefined;
  };
  /** USD deducted from the account balance for this solve. */
  cost: number;
  type: "akamai";
}

export interface RecaptchaV3Result {
  token: string;
  /**
   * Response discriminator. The API may echo either the bare `recaptchav3`
   * request type or the hyphenated `recaptcha-v3` slug.
   */
  type: "recaptchav3" | "recaptcha-v3";
  /** USD deducted from the account balance for this solve. */
  cost: number;
}

export interface BalanceResult {
  balance: number;
  unlimited: boolean;
  allowedTypes: string[];
  /** Per-key captchas-per-minute ceiling. 0 means uncapped. */
  maxCpm: number;
  /** Tokens consumed in the rolling CPM window. */
  currentCpm: number;
  /** Mirror of maxCpm — useful for dashboards. */
  cpmLimit: number;
  unlimitedExpiresAt?: string;
}

interface APIErrorBody {
  success: false;
  error: string;
}

interface APISolveTurnstileBody {
  success: true;
  token: string;
  cost?: number;
  type: "turnstile";
}

interface APISolveChallengeBody {
  success: true;
  cookies: { cf_clearance: string; [key: string]: string };
  user_agent: string;
  token?: string;
  cost?: number;
  type: "challenge";
}

interface APISolveKasadaBody {
  success: true;
  headers: {
    "x-kpsdk-ct": string;
    "x-kpsdk-cd": string;
    "x-kpsdk-v": string;
    "x-kpsdk-h": string;
  };
  cost?: number;
  type: "kasada";
}

interface APISolveAkamaiBody {
  success: true;
  cookies: { [key: string]: string };
  cost?: number;
  type: "akamai";
}

interface APISolveRecaptchaV3Body {
  success: true;
  token: string;
  cost?: number;
  type: "recaptchav3" | "recaptcha-v3";
}

interface APIBalanceBody {
  success: true;
  balance: number;
  unlimited: boolean;
  allowed_types: string[];
  max_cpm: number;
  current_cpm: number;
  cpm_limit: number;
  unlimited_expires_at?: string;
}

export class NSLSolverError extends Error {
  public readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "NSLSolverError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends NSLSolverError {
  constructor(message: string) {
    super(message, 401);
    this.name = "AuthenticationError";
  }
}

export class InsufficientBalanceError extends NSLSolverError {
  constructor(message: string) {
    super(message, 402);
    this.name = "InsufficientBalanceError";
  }
}

export class ForbiddenError extends NSLSolverError {
  constructor(message: string) {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class RateLimitError extends NSLSolverError {
  constructor(message: string) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

export class SolveError extends NSLSolverError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "SolveError";
  }
}

const DEFAULT_BASE_URL = "https://api.nslsolver.com";
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_RETRIES = 3;

/** API client for solving Cloudflare Turnstile, Challenge, Kasada, Akamai, and reCAPTCHA v3 captchas. */
export class NSLSolver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(apiKey: string, config: NSLSolverConfig = {}) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new NSLSolverError("API key is required and must be a non-empty string.");
    }

    this.apiKey = apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Solve a Cloudflare Turnstile captcha. */
  async solveTurnstile(params: TurnstileParams): Promise<TurnstileResult> {
    const body: Record<string, unknown> = {
      type: "turnstile",
      site_key: params.siteKey,
      url: params.url,
    };
    if (params.action !== undefined) body.action = params.action;
    if (params.cdata !== undefined) body.cdata = params.cdata;
    if (params.proxy !== undefined) body.proxy = params.proxy;
    if (params.userAgent !== undefined) body.user_agent = params.userAgent;

    const data = await this.request<APISolveTurnstileBody>("POST", "/solve", body);

    return {
      token: data.token,
      cost: data.cost ?? 0,
      type: data.type,
    };
  }

  /** Solve a Cloudflare Challenge page. Proxy is required. */
  async solveChallenge(params: ChallengeParams): Promise<ChallengeResult> {
    const body: Record<string, unknown> = {
      type: "challenge",
      url: params.url,
      proxy: params.proxy,
    };
    if (params.userAgent !== undefined) body.user_agent = params.userAgent;

    const data = await this.request<APISolveChallengeBody>("POST", "/solve", body);

    return {
      cookies: data.cookies,
      userAgent: data.user_agent,
      token: data.token,
      cost: data.cost ?? 0,
      type: data.type,
    };
  }

  /** Solve a Kasada challenge. */
  async solveKasada(params: KasadaParams): Promise<KasadaResult> {
    const kasadaConfig: Record<string, unknown> = {
      p_js_path: params.kasadaConfig.pJsPath,
      fp_host: params.kasadaConfig.fpHost,
      tl_host: params.kasadaConfig.tlHost,
    };
    if (params.kasadaConfig.cdConstant !== undefined) kasadaConfig.cd_constant = params.kasadaConfig.cdConstant;

    const body: Record<string, unknown> = {
      type: "kasada",
      url: params.url,
      user_agent: params.userAgent,
      ua_version: params.uaVersion,
      kasada_config: kasadaConfig,
    };
    if (params.proxy !== undefined) body.proxy = params.proxy;

    const data = await this.request<APISolveKasadaBody>("POST", "/solve", body);

    return {
      headers: data.headers,
      cost: data.cost ?? 0,
      type: data.type,
    };
  }

  /** Solve an Akamai Bot Manager challenge. Both `userAgent` and `proxy` are required. */
  async solveAkamai(params: AkamaiParams): Promise<AkamaiResult> {
    const body: Record<string, unknown> = {
      type: "akamai",
      url: params.url,
      user_agent: params.userAgent,
      proxy: params.proxy,
    };

    const data = await this.request<APISolveAkamaiBody>("POST", "/solve", body);

    return {
      cookies: data.cookies,
      cost: data.cost ?? 0,
      type: data.type,
    };
  }

  /** Solve a reCAPTCHA v3 (or reCAPTCHA Enterprise) challenge. Proxy is required. */
  async solveRecaptchaV3(params: RecaptchaV3Params): Promise<RecaptchaV3Result> {
    const body: Record<string, unknown> = {
      type: "recaptchav3",
      site_key: params.siteKey,
      url: params.url,
      proxy: params.proxy,
    };
    if (params.action !== undefined) body.action = params.action;
    if (params.enterprise) body.enterprise = true;
    if (params.userAgent !== undefined) body.user_agent = params.userAgent;

    const data = await this.request<APISolveRecaptchaV3Body>("POST", "/solve", body);

    return {
      token: data.token,
      type: data.type,
      cost: data.cost ?? 0,
    };
  }

  /** Get account balance, plan flags, and live CPM usage. */
  async getBalance(): Promise<BalanceResult> {
    const data = await this.request<APIBalanceBody>("GET", "/balance");

    return {
      balance: data.balance,
      unlimited: data.unlimited,
      allowedTypes: data.allowed_types,
      maxCpm: data.max_cpm,
      currentCpm: data.current_cpm,
      cpmLimit: data.cpm_limit ?? data.max_cpm,
      unlimitedExpiresAt: data.unlimited_expires_at,
    };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Accept": "application/json",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | undefined;
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
        // Prefer a server-supplied Retry-After over computed backoff, capped.
        const delay =
          retryAfterMs !== undefined ? Math.min(retryAfterMs, 60_000) : backoff;
        retryAfterMs = undefined;
        await this.sleep(delay);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        // Detect aborts by name — `instanceof DOMException` is unreliable
        // across Node/undici builds where the rejection is a plain Error.
        if (err && (err as { name?: string }).name === "AbortError") {
          lastError = new NSLSolverError(
            `Request timed out after ${this.timeout}ms`,
          );
          continue;
        }
        const networkError = new NSLSolverError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Unrecoverable connection failures (bad host, refused) will never
        // succeed on retry — surface them immediately instead of burning the
        // full backoff budget.
        if (NSLSolver.isFatalNetworkError(err)) {
          throw networkError;
        }
        lastError = networkError;
        continue;
      } finally {
        clearTimeout(timer);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        lastError = new NSLSolverError(
          `Failed to parse API response (HTTP ${response.status})`,
          response.status,
        );
        if (response.status >= 500) {
          retryAfterMs = NSLSolver.parseRetryAfter(response);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return json as T;
      }

      const errorMessage =
        (json as APIErrorBody)?.error ?? `API error (HTTP ${response.status})`;

      switch (response.status) {
        case 400:
          throw new SolveError(errorMessage, 400);
        case 401:
          throw new AuthenticationError(errorMessage);
        case 402:
          throw new InsufficientBalanceError(errorMessage);
        case 403:
          throw new ForbiddenError(errorMessage);
        case 429:
          lastError = new RateLimitError(errorMessage);
          retryAfterMs = NSLSolver.parseRetryAfter(response);
          continue;
        case 503:
          lastError = new SolveError(errorMessage, 503);
          retryAfterMs = NSLSolver.parseRetryAfter(response);
          continue;
        default:
          throw new NSLSolverError(errorMessage, response.status);
      }
    }

    throw lastError ?? new NSLSolverError("Request failed after all retries.");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Classify connection failures that can never succeed on retry (bad host,
   * malformed URL, refused connection) so the client fails fast instead of
   * exhausting its retry budget. Inspects both the Node `code`/`cause.code`
   * and the error message for portability across runtimes.
   */
  private static isFatalNetworkError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const fatalCodes = ["ENOTFOUND", "ECONNREFUSED", "ERR_INVALID_URL"];
    const candidate = err as {
      code?: string;
      message?: string;
      cause?: { code?: string };
    };
    const code = candidate.code ?? candidate.cause?.code;
    if (code && fatalCodes.includes(code)) return true;
    const message = candidate.message ?? "";
    return fatalCodes.some((c) => message.includes(c));
  }

  /**
   * Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds.
   * Returns undefined when absent or unparseable. The NSLSolver tier does not
   * currently emit this header; this is purely defensive for proxies/future use.
   */
  private static parseRetryAfter(response: Response): number | undefined {
    const raw = response.headers.get("retry-after");
    if (!raw) return undefined;

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return seconds > 0 ? seconds * 1000 : 0;
    }

    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }

    return undefined;
  }
}

export default NSLSolver;

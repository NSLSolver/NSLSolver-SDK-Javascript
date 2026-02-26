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

export interface TurnstileResult {
  token: string;
  type: "turnstile";
}

export interface ChallengeResult {
  cookies: {
    cf_clearance: string;
    [key: string]: string;
  };
  userAgent: string;
  type: "challenge";
}

export interface BalanceResult {
  balance: number;
  unlimited: boolean;
  allowedTypes: string[];
  /** 0 means unlimited */
  maxThreads: number;
  unlimitedExpiresAt?: string;
}

interface APIErrorBody {
  success: false;
  error: string;
}

interface APISolveTurnstileBody {
  success: true;
  token: string;
  type: "turnstile";
}

interface APISolveChallengeBody {
  success: true;
  cookies: { cf_clearance: string; [key: string]: string };
  user_agent: string;
  type: "challenge";
}

interface APIBalanceBody {
  success: true;
  balance: number;
  unlimited: boolean;
  allowed_types: string[];
  max_threads: number;
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

/** API client for solving Cloudflare Turnstile and Challenge captchas. */
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
      type: data.type,
    };
  }

  /** Get account balance and metadata. */
  async getBalance(): Promise<BalanceResult> {
    const data = await this.request<APIBalanceBody>("GET", "/balance");

    return {
      balance: data.balance,
      unlimited: data.unlimited,
      allowedTypes: data.allowed_types,
      maxThreads: data.max_threads,
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

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
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
        if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new NSLSolverError(
            `Request timed out after ${this.timeout}ms`,
          );
          continue;
        }
        lastError = new NSLSolverError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
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
        if (response.status >= 500) continue;
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
          continue;
        case 503:
          lastError = new SolveError(errorMessage, 503);
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
}

export default NSLSolver;

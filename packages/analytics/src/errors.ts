import type { Capability } from "@hostpog/contracts";

export type ProviderErrorCode =
  | "unauthorized" // 401: credential invalid/expired/revoked
  | "forbidden" // 403: missing scope or project access
  | "not_found"
  | "rate_limited" // 429
  | "budget_exhausted" // our own per-credential budget
  | "timeout"
  | "cancelled"
  | "upstream" // 5xx
  | "bad_query" // 400
  | "unsupported";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly missingScope?: string;
  constructor(
    code: ProviderErrorCode,
    message: string,
    extra: { status?: number; retryAfterSeconds?: number; missingScope?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: extra.cause });
    this.name = "ProviderError";
    this.code = code;
    this.status = extra.status;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.missingScope = extra.missingScope;
  }

  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "upstream" || this.code === "timeout";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      retryAfterSeconds: this.retryAfterSeconds,
      missingScope: this.missingScope,
    };
  }
}

export class UnsupportedCapabilityError extends ProviderError {
  readonly capability: Capability;
  constructor(capability: Capability, reason: string) {
    super("unsupported", `${capability} is not available for this source: ${reason}`);
    this.capability = capability;
  }
}

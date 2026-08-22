import type { ApiErrorBody } from "@/contracts/api";

/**
 * Every failure the app can see from the engine, normalized to one shape so
 * the UI never has to distinguish "network died" from "engine said 500".
 */
export type ApiErrorKind =
  | "network" // never reached the engine (DNS, CORS, offline)
  | "timeout" // request aborted by our own deadline
  | "aborted" // caller cancelled (unmount, superseded poll)
  | "http"; // engine answered with a non-2xx status

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly detail: unknown;
  readonly url: string;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    url: string;
    status?: number | null;
    errorCode?: string | null;
    detail?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.url = init.url;
    this.status = init.status ?? null;
    this.errorCode = init.errorCode ?? null;
    this.detail = init.detail ?? null;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    if (this.kind === "aborted") return false;
    if (this.kind === "network" || this.kind === "timeout") return true;
    if (this.status === null) return true;
    if (this.status === 408 || this.status === 429) return true;
    return this.status >= 500;
  }

  /** Short line for a card's inline error state. Never leaks a stack trace. */
  get displayMessage(): string {
    switch (this.kind) {
      case "timeout":
        return "Request timed out";
      case "network":
        return "Cannot reach engine";
      case "aborted":
        return "Cancelled";
      default:
        return this.message;
    }
  }
}

/** Turn a FastAPI error envelope (or a validation error) into one line. */
export function messageFromBody(
  body: ApiErrorBody | unknown,
  status: number,
): { message: string; errorCode: string | null; detail: unknown } {
  if (body && typeof body === "object") {
    const envelope = body as ApiErrorBody;

    // FastAPI request-validation errors: { detail: [{ loc, msg, type }] }
    if (Array.isArray(envelope.detail)) {
      const parts = envelope.detail
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as { loc?: unknown[]; msg?: string };
          const where = Array.isArray(item.loc)
            ? item.loc.filter((segment) => segment !== "body").join(".")
            : "";
          return where ? `${where}: ${item.msg ?? ""}`.trim() : (item.msg ?? null);
        })
        .filter((part): part is string => Boolean(part));
      if (parts.length > 0) {
        return {
          message: parts.join("; "),
          errorCode: envelope.error_code ?? "VALIDATION_ERROR",
          detail: envelope.detail,
        };
      }
    }

    if (typeof envelope.message === "string" && envelope.message) {
      return {
        message: envelope.message,
        errorCode: envelope.error_code ?? null,
        detail: envelope.detail ?? null,
      };
    }

    if (typeof envelope.detail === "string" && envelope.detail) {
      return {
        message: envelope.detail,
        errorCode: envelope.error_code ?? null,
        detail: null,
      };
    }
  }

  if (typeof body === "string" && body.trim()) {
    return { message: body.trim().slice(0, 300), errorCode: null, detail: null };
  }

  return { message: `Engine returned HTTP ${status}`, errorCode: null, detail: null };
}

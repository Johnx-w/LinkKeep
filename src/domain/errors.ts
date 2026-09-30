export type DomainErrorCode =
  | "NO_LINK"
  | "MULTIPLE_LINKS"
  | "UNSUPPORTED_LINK"
  | "UNSAFE_LINK"
  | "PLATFORM_DISABLED"
  | "CONTENT_RESTRICTED"
  | "CONTENT_UNAVAILABLE"
  | "CONTENT_BLOCKED"
  | "PARSE_TIMEOUT"
  | "PARSE_FAILED"
  | "UNSAFE_MEDIA"
  | "MEDIA_TOO_LARGE"
  | "PROXY_BUDGET_EXHAUSTED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message = code,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

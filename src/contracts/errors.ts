/** Messages must be safe to return to callers; never pass an upstream message. */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

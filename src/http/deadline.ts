import { ServiceError } from "../contracts/errors.js";

export async function withDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  error: ServiceError,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline: ((reason: unknown) => void) | undefined;
  const rejected = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const abort = (reason: unknown) => {
    controller.abort(reason);
    rejectDeadline?.(reason);
  };
  const onParentAbort = () => abort(parent?.reason ?? error);
  const timeout = setTimeout(() => abort(error), milliseconds);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  try {
    if (parent?.aborted) onParentAbort();
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return task(controller.signal);
      }),
      rejected,
    ]);
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

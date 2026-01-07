import logger from "./logger";

/**
 * Minimal span helper (poor-man's tracing) that ties together start/end/error
 * logs with timing.
 *
 * Works well with AsyncLocalStorage context injection from logger.ts.
 */
export async function withSpan<T>(
  name: string,
  meta: Record<string, unknown> | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  logger.info("span.start", { span: name, ...(meta ?? {}) });
  try {
    const res = await fn();
    logger.info("span.end", { span: name, durationMs: Date.now() - start, ...(meta ?? {}) });
    return res;
  } catch (err: any) {
    logger.error("span.error", {
      span: name,
      durationMs: Date.now() - start,
      errorMessage: err?.message ?? String(err),
      ...(meta ?? {}),
    });
    throw err;
  }
}


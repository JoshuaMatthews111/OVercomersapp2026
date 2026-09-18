/** Bound a stalled network request while preserving a caller's cancellation. */
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const originalSignal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const cancel = () => controller.abort();
  if (originalSignal?.aborted) cancel();
  else originalSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener('abort', cancel);
  }
}

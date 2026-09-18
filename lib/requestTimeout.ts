/**
 * How long the app is willing to wait, kept in one place.
 *
 * Everyday reads and writes keep a short leash so a dead connection fails fast
 * and the person sees a clear message instead of a spinner. A file upload cannot
 * live under that rule: a two hundred megabyte video on a church car-park signal
 * is not broken, it is simply big. So uploads get a budget that grows with the
 * payload, plus a stall watchdog that only fires once bytes genuinely stop moving.
 */

/** Everyday queries: fail fast so a screen never spins forever. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** A transfer is only "stuck" once no bytes have moved for this long. */
export const STALL_TIMEOUT_MS = 45_000;

/** The slowest uplink still worth waiting for: roughly 0.4 Mbps. */
const ASSUMED_UPLOAD_BYTES_PER_SECOND = 48 * 1024;

/** Room for the handshake, the auth check and the server storing the object. */
const UPLOAD_OVERHEAD_MS = 20_000;

/** Nothing waits longer than this, however large the file. */
const UPLOAD_CEILING_MS = 45 * 60 * 1000;

/** A storage write whose size we cannot measure (a web FormData body, say). */
const UNKNOWN_UPLOAD_BODY_MS = 5 * 60 * 1000;

/**
 * A wall-clock budget sized to the payload.
 *
 * A 120 KB thumbnail gets about 22 s instead of the old flat 120 s, so a broken
 * connection is reported almost immediately. A 40 MB video gets about 15 minutes
 * instead of being killed mid-transfer at two.
 */
export function uploadTimeoutMs(sizeBytes = 0): number {
  const bytes = Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
  const transferMs = (bytes / ASSUMED_UPLOAD_BYTES_PER_SECOND) * 1000;
  return Math.min(UPLOAD_OVERHEAD_MS + transferMs, UPLOAD_CEILING_MS);
}

/** True when a promise rejected because someone (or a watchdog) cancelled it. */
export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if ((error as { name?: unknown }).name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\baborted?\b|\bcancell?ed\b/i.test(message);
}

export type TransferWatchdog = {
  /** Hand this to an UploadTask (or a fetch) so a timeout actually stops the work. */
  readonly signal: AbortSignal;
  /** Call on every progress tick. Re-arms the stall timer. */
  touch(): void;
  /** Call once the transfer has finished, however it finished. */
  stop(): void;
  /** Says which timer fired, so the caller can choose the right words. */
  firedAs(): 'stall' | 'overall' | null;
};

/**
 * A timer that is re-armed by activity rather than armed once and forgotten.
 *
 * The old behaviour aborted a perfectly healthy transfer the moment it crossed a
 * flat deadline. This keeps two clocks: a stall clock reset by every progress
 * tick, and a generous overall ceiling as a backstop.
 */
export function createTransferWatchdog(
  options: { stallMs?: number; overallMs?: number; signal?: AbortSignal } = {}
): TransferWatchdog {
  const stallMs = options.stallMs ?? STALL_TIMEOUT_MS;
  const overallMs = options.overallMs ?? uploadTimeoutMs(0);
  const controller = new AbortController();

  let fired: 'stall' | 'overall' | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  function clearTimers() {
    if (stallTimer) clearTimeout(stallTimer);
    if (overallTimer) clearTimeout(overallTimer);
    stallTimer = undefined;
    overallTimer = undefined;
  }

  function stop() {
    if (finished) return;
    finished = true;
    clearTimers();
    options.signal?.removeEventListener('abort', onOuterAbort);
  }

  function fire(reason: 'stall' | 'overall') {
    if (finished) return;
    fired = reason;
    stop();
    controller.abort();
  }

  function onOuterAbort() {
    stop();
    controller.abort();
  }

  function armStall() {
    if (finished) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => fire('stall'), stallMs);
  }

  if (options.signal?.aborted) {
    finished = true;
    controller.abort();
  } else {
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    overallTimer = setTimeout(() => fire('overall'), overallMs);
    armStall();
  }

  return {
    signal: controller.signal,
    touch: armStall,
    stop,
    firedAs: () => fired,
  };
}

/** Bound a stalled network request while preserving a caller's cancellation. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
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

const STORAGE_OBJECT_PATH = '/storage/v1/object/';

// These storage endpoints carry a small JSON body. They are metadata calls, not
// file transfers, so they keep the everyday budget — a flat two minutes on a
// signing call just means the screen hangs for two minutes when storage is sick.
const STORAGE_METADATA_PATHS = [
  '/object/sign/',
  '/object/upload/sign/',
  '/object/list/',
  '/object/info/',
  '/object/public/',
  '/object/copy',
  '/object/move',
];

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  const maybeRequest = input as { url?: unknown };
  return typeof maybeRequest?.url === 'string' ? maybeRequest.url : String(input);
}

function requestBodySize(body: unknown): number {
  if (!body) return 0;
  if (typeof body === 'string') return body.length;
  if (typeof ArrayBuffer !== 'undefined') {
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
  }
  const size = (body as { size?: unknown }).size;
  return typeof size === 'number' && size > 0 ? size : 0;
}

/**
 * The budget for one Supabase request: short for everything except an actual
 * file write, which is sized to the bytes being written.
 */
export function supabaseFetchTimeoutMs(input: RequestInfo | URL, init?: RequestInit): number {
  if (!init?.body) return DEFAULT_TIMEOUT_MS;
  const url = requestUrlOf(input);
  if (!url.includes(STORAGE_OBJECT_PATH)) return DEFAULT_TIMEOUT_MS;
  if (STORAGE_METADATA_PATHS.some((path) => url.includes(path))) return DEFAULT_TIMEOUT_MS;
  const size = requestBodySize(init.body);
  return size > 0 ? uploadTimeoutMs(size) : UNKNOWN_UPLOAD_BODY_MS;
}

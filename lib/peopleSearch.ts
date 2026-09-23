// Finding a person by typing their name.
//
// The owner's words, TestFlight 36: "searching while typing home cells — the
// name drops down when adding a home cell leader; we should really have to hit
// the search button? a list should show with their profile pic as we type
// their name."
//
// So: no Search button anywhere a PERSON is picked. This file is the part with
// no React and no network in it — the rules about when to ask, what to throw
// away and what the screen should be showing — so it can be tested on its own
// (qa/outreach-person-search.test.mjs).
//
// Three rules it keeps:
//
//   * Wait 250 ms after the last keystroke. Typing "Josh" is four keystrokes
//     and must be one request, not four.
//   * Two letters at least. One letter matches half the church and the answer
//     is useless to the person reading it.
//   * The answer to a question nobody is asking any more is thrown away, and
//     the request itself is aborted. Without that, a slow answer for "Jo"
//     lands after the quick answer for "Joshua" and overwrites it — the list
//     then shows names that do not match what is on screen.
//
// NOTE: this is for people only. The ADDRESS search keeps its Find button:
// OpenStreetMap's Nominatim asks for at most one request a second, and typing
// would break that promise (lib/homeCells.ts, DO-NOT-BREAK outreach lane).

export const PERSON_SEARCH_DELAY_MS = 250;
export const PERSON_SEARCH_MIN_CHARS = 2;

export type PersonSearchStatus = 'idle' | 'too-short' | 'searching' | 'done' | 'failed';

export type PersonSearchState<T> = {
  /** Exactly what is in the box, so the screen never has to keep its own copy. */
  term: string;
  status: PersonSearchStatus;
  /** The people found for the term that is CURRENTLY in the box. */
  results: T[];
  /** Set only when status is 'failed'. Already written for a person to read. */
  error?: string;
};

export type PersonSearchController<T> = {
  /** Called on every keystroke. */
  type: (text: string) => void;
  /** After a failure: ask again for the same term, straight away. */
  retry: () => void;
  /** Empty the box and the list, without asking anything. */
  clear: () => void;
  /** Called when the screen goes away: stop the timer, drop the answer. */
  dispose: () => void;
  state: () => PersonSearchState<T>;
};

type Timers = {
  setTimeout: (fn: () => void, ms: number) => any;
  clearTimeout: (handle: any) => void;
};

export function createPersonSearch<T>(options: {
  /** The real lookup. `signal` aborts the request itself when it can. */
  search: (term: string, signal?: AbortSignal) => Promise<T[]>;
  /** Called every time the screen should be redrawn. */
  onState: (state: PersonSearchState<T>) => void;
  /** Turn whatever the lookup threw into one sentence. */
  describeError?: (error: unknown) => string;
  delayMs?: number;
  minChars?: number;
  /** Swapped out in tests so nothing has to wait in real time. */
  timers?: Timers;
  /** Swapped out where AbortController does not exist. */
  makeAbort?: () => AbortController | null;
}): PersonSearchController<T> {
  const delayMs = options.delayMs ?? PERSON_SEARCH_DELAY_MS;
  const minChars = options.minChars ?? PERSON_SEARCH_MIN_CHARS;
  const timers: Timers = options.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };
  const makeAbort = options.makeAbort || (() => (typeof AbortController === 'function' ? new AbortController() : null));
  const describeError = options.describeError || (() => 'Those names could not load just now.');

  let state: PersonSearchState<T> = { term: '', status: 'idle', results: [] };
  let timer: any = null;
  let inFlight: AbortController | null = null;
  let generation = 0;
  let disposed = false;

  function publish(next: Partial<PersonSearchState<T>>) {
    state = { ...state, ...next };
    if (!disposed) options.onState(state);
  }

  function stopWaiting() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  /** Drop the answer to the question that is no longer being asked. */
  function abandonInFlight() {
    generation += 1;
    if (inFlight) {
      try {
        inFlight.abort();
      } catch (error) {
        // Nothing on screen depends on the abort succeeding — the answer is
        // thrown away either way by the generation check below.
        console.warn('A name search could not be stopped early:', error instanceof Error ? error.message : 'unknown problem');
      }
      inFlight = null;
    }
  }

  async function run(term: string) {
    abandonInFlight();
    const mine = generation;
    const controller = makeAbort();
    inFlight = controller;
    publish({ status: 'searching', error: undefined });
    try {
      const results = await options.search(term, controller?.signal);
      if (mine !== generation || disposed) return;
      inFlight = null;
      publish({ status: 'done', results, error: undefined });
    } catch (error) {
      if (mine !== generation || disposed) return;
      inFlight = null;
      publish({ status: 'failed', results: [], error: describeError(error) });
    }
  }

  function type(text: string) {
    stopWaiting();
    const term = text.trim();
    if (term.length < minChars) {
      // Nothing is in flight any more, and the list goes with it: leaving the
      // last list on screen under a half-deleted name is a lie.
      abandonInFlight();
      publish({ term: text, status: term.length ? 'too-short' : 'idle', results: [], error: undefined });
      return;
    }
    // Stop the request that is already out BEFORE the wait begins, not when
    // the next one starts. Without this there is a 250 ms window in which the
    // answer to the PREVIOUS name arrives, passes the generation check (nothing
    // has bumped it yet) and paints itself under the name now in the box — the
    // list would read "done" while showing people who do not match.
    abandonInFlight();
    publish({ term: text, status: 'searching', error: undefined });
    timer = timers.setTimeout(() => {
      timer = null;
      void run(term);
    }, delayMs);
  }

  return {
    type,
    retry: () => {
      stopWaiting();
      const term = state.term.trim();
      if (term.length < minChars) return;
      void run(term);
    },
    clear: () => {
      stopWaiting();
      abandonInFlight();
      publish({ term: '', status: 'idle', results: [], error: undefined });
    },
    dispose: () => {
      stopWaiting();
      abandonInFlight();
      disposed = true;
    },
    state: () => state,
  };
}

/**
 * The one line under the search box: what is happening, in plain words.
 * Returns null when the list itself is the answer and a sentence would be noise.
 */
export function personSearchNote<T>(state: PersonSearchState<T>, options: { noun?: string } = {}): string | null {
  const noun = options.noun || 'Nobody';
  if (state.status === 'too-short') return `Keep typing — ${PERSON_SEARCH_MIN_CHARS} letters or more.`;
  if (state.status === 'failed') return state.error || 'Those names could not load just now.';
  if (state.status === 'done' && !state.results.length) return `${noun} by that name.`;
  return null;
}

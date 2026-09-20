/**
 * The two animals arguing about their books. The relay writes each line (Gemini) and says it
 * (ElevenLabs); this plays them one after another, feeding the argument so far back up so the
 * insults escalate instead of resetting.
 *
 * The reply is written and voiced while the current line is still playing, so the gap between
 * turns is playback rather than two APIs thinking.
 */
export type Speaker = "fly" | "worm";
export interface Turn { speaker: Speaker; text: string }

/** Lines per press before it stops itself. Every turn is billed, so an unattended exhibit cannot
 *  run up the bill; pressing translate again starts a fresh argument. */
const MAX_TURNS = 12;
const SILENT_MS = 8_000;    // nothing loaded and nothing played: move on regardless
const TAIL_MS = 1_500;      // a beat after the line is over, in case `ended` never arrives

export interface BanterEvents {
  onLine(turn: Turn): void;
  onSpeaking(speaking: boolean): void;
  onError(message: string): void;
  /** The argument ended on its own, by cap or by error. Not called when it was stopped. */
  onDone(): void;
}

export interface Banter { stop(): void }

interface Line { turn: Turn; url: string }

const other = (s: Speaker): Speaker => (s === "fly" ? "worm" : "fly");

/** The relay answers errors as { error }, so say what went wrong rather than just the status. */
async function fail(res: Response, what: string): Promise<Error> {
  const detail = await res.json().then((b: { error?: string }) => b?.error).catch(() => null);
  return new Error(detail ? `${what}: ${detail}` : `${what} (${res.status})`);
}

export function startBanter(events: BanterEvents): Banter {
  const abort = new AbortController();
  let stopped = false;
  let playing: HTMLAudioElement | null = null;
  let pending: Promise<Line> | null = null;

  const post = (path: string, body: unknown) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

  /** One line, written and voiced. */
  const compose = async (speaker: Speaker, history: Turn[]): Promise<Line> => {
    const written = await post("/api/banter", { speaker, history });
    if (!written.ok) throw await fail(written, "could not write the line");
    const turn = await written.json() as Turn;

    const spoken = await post("/api/speak", turn);
    if (!spoken.ok) throw await fail(spoken, "could not speak the line");
    return { turn, url: URL.createObjectURL(await spoken.blob()) };
  };

  /**
   * Resolves when the line has finished — or failed, or never started. A machine with no working
   * audio output leaves play() pending and fires neither `ended` nor `error`, so the clock is what
   * moves the argument on: the captions keep going even where nothing can be heard.
   */
  const play = (url: string) => new Promise<void>((resolve) => {
    const el = new Audio(url);
    playing = el;
    let watchdog = setTimeout(done, SILENT_MS);

    function done(): void {
      clearTimeout(watchdog);
      el.removeEventListener("ended", done);
      el.removeEventListener("error", done);
      el.removeEventListener("loadedmetadata", measured);
      if (playing === el) playing = null;
      resolve();
    }
    // once the length is known, wait exactly that long plus a beat, and no longer
    function measured(): void {
      if (!Number.isFinite(el.duration)) return;
      clearTimeout(watchdog);
      watchdog = setTimeout(done, el.duration * 1000 + TAIL_MS);
    }

    el.addEventListener("ended", done);
    el.addEventListener("error", done);
    el.addEventListener("loadedmetadata", measured);
    void el.play().catch(done);
  });

  void (async () => {
    const history: Turn[] = [];
    let speaker: Speaker = "fly";      // the fly opens; it would insist
    let spoken = 0;
    try {
      pending = compose(speaker, history);
      while (pending && !stopped) {
        const line = await pending;
        pending = null;
        if (stopped) { URL.revokeObjectURL(line.url); break; }

        history.push(line.turn);
        spoken += 1;
        speaker = other(speaker);
        // the answer goes into flight now, so it is ready the moment this line stops
        if (spoken < MAX_TURNS) pending = compose(speaker, [...history]);

        events.onLine(line.turn);
        events.onSpeaking(true);
        await play(line.url);
        events.onSpeaking(false);
        URL.revokeObjectURL(line.url);
      }
      if (!stopped) events.onDone();
    } catch (e) {
      if (stopped || abort.signal.aborted) return;   // stopping cancels the fetches mid-flight
      events.onSpeaking(false);
      events.onError(String((e as Error).message ?? e));
      events.onDone();
    } finally {
      // a reply we asked for and will never play: swallow its abort, let go of its audio
      pending?.then((line) => URL.revokeObjectURL(line.url), () => {});
    }
  })();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      playing?.pause();
      playing = null;
    },
  };
}

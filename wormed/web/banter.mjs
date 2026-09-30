// The two traders talking. Gemini writes the next line of the argument, ElevenLabs says it in the
// animal's own voice, and the relay serves both to the page -- the keys are read here and never
// reach the browser, the same boundary the fee payer's key sits behind.
//
// The standings on the wall are the material: the fly and the worm brag with the profit and trade
// counts the exhibit is actually showing, so the trash talk cannot contradict the scoreboard.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The repo's one .env, two directories up. Values already in the environment win: a shell that
// exported a key meant it. Missing file is not an error -- the routes report the missing key.
export function loadEnv(file = fileURLToPath(new URL("../../.env", import.meta.url))) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_FALLBACK = "gemini-3.5-flash";
const DEFAULT_VOICE_MODEL = "eleven_flash_v2_5";
const FORMAT = "mp3_44100_128";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const HOPELESS = new Set([400, 401, 403]);   // a bad key or a bad request: no model will mend it
const BACKOFF_MS = [400, 1200];

/** Which models write the lines, in the order they are tried. Empty fallback means no understudy. */
function models() {
  const first = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const second = process.env.GEMINI_FALLBACK_MODEL?.trim() ?? DEFAULT_FALLBACK;
  return [first, second].filter((m, i, all) => m && all.indexOf(m) === i);
}

const CHARACTERS = `FLY: Drosophila, 134 neurons of central complex running on the Thru chain, reading its own heading bump as a trading signal. Smug, quick, talks like a day trader who has never once admitted a loss.
WORM: C. elegans, all 302 neurons on chain, every synapse a real transfer between neuron accounts. Slower, dirtier, certain the fly is a rich kid with a big wallet and no instincts.`;

const RULES = `Rules:
- One sentence, 20 words at most. No quotation marks, no emoji, no stage directions, no name prefix.
- Answer the line before it directly and escalate. Do not restart the argument or repeat an earlier jab.
- Keep it to crypto and trading: portfolios, gas, liquidations, cold wallets, rug pulls.
- Use the standings when they sharpen the brag. Never claim to be winning if the board says otherwise.
- Playful smack talk only. No slurs, no threats.`;

/** The wall's own numbers, phrased for a prompt. */
function scoreboard(board) {
  const rows = board?.standings ?? [];
  if (!rows.length) return "The board is still warming up, so both traders are bluffing. Invent figures and sound certain.";
  const said = rows.map((r) => `${r.specimen} is at ${r.profit} over ${r.trades} trades`).join(", ");
  const tx = board.transactions ? `, ${board.transactions.toLocaleString()} transactions settled on Thru` : "";
  return `The board behind the desks reads: ${said}${tx}.`;
}

function prompt(speaker, history, board) {
  const recent = history.slice(-6);
  const soFar = recent.length
    ? `So far:\n${recent.map((t) => `${String(t.speaker).toUpperCase()}: ${t.text}`).join("\n")}`
    : "Nothing has been said yet. Open the battle.";
  return `${scoreboard(board)}\n\n${soFar}\n\nWrite the next line for ${speaker.toUpperCase()}.`;
}

const textOf = (data) =>
  (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text.trim()).join(" ").trim();

const finishOf = (data) => data?.candidates?.[0]?.finishReason;

/** Models hand back a name badge and quotes however firmly you ask them not to. */
const tidy = (line) =>
  line.replace(/^\s*(fly|worm)\s*[:\-]\s*/i, "").replace(/^["“”']+|["“”']+$/g, "")
      .replace(/\s+/g, " ").trim();

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("stopped")); }, { once: true });
});

/** The next line of the argument. Throws with a message worth showing on the page. */
export async function writeLine(speaker, history, board, signal) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: `You write one line of dialogue for a live exhibit.\n\n${CHARACTERS}\n\n${RULES}` }] },
    contents: [{ role: "user", parts: [{ text: prompt(speaker, history, board) }] }],
    // low thinking: a trader who pauses to reason has lost the room, and the page is waiting on
    // this before it can speak. The budget is generous anyway -- a line cut off mid-insult lands badly.
    generationConfig: { temperature: 1.15, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: "low" } },
  });

  let last = new Error("no model answered");
  for (const model of models()) {
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      if (attempt) await wait(BACKOFF_MS[attempt - 1], signal);

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body, signal,
      });

      if (!res.ok) {
        const detail = `${model} said ${res.status}: ${(await res.text()).slice(0, 200)}`;
        if (HOPELESS.has(res.status)) throw new Error(detail);
        last = new Error(detail);
        if (RETRYABLE.has(res.status)) continue;
        break;                                   // give the understudy a turn
      }

      const data = await res.json();
      const text = tidy(textOf(data));
      if (text && finishOf(data) !== "MAX_TOKENS") return text;
      last = new Error(text ? `${model} was cut off mid-line` : `${model} returned nothing to say`);
    }
  }
  throw last;
}

/** The line as speech. Returns the upstream response so the relay can pipe it straight out. */
export async function speak(speaker, text, signal) {
  const key = process.env.ELEVEN_LABS_API_KEY;
  if (!key) throw new Error("ELEVEN_LABS_API_KEY is not set");
  const voiceId = speaker === "worm" ? process.env.WORM_VOICE_ID : process.env.FLY_VOICE_ID;
  if (!voiceId) throw new Error(`no voice id for the ${speaker}`);
  const model = process.env.ELEVEN_LABS_MODEL?.trim() || DEFAULT_VOICE_MODEL;

  // the fly is quick and full of itself; the worm is slower and rougher around the edges
  const settings = speaker === "worm"
    ? { stability: 0.2, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true, speed: 0.95 }
    : { stability: 0.3, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true, speed: 1.1 };

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

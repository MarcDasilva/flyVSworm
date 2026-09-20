import assert from "node:assert/strict";
import { readMuted, setMuted } from "./ambience.js";

// A first visit has no stored preference and MUST open with sound on; a
// missing key that read as muted would silence every new visitor.
const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
assert.equal(readMuted(storage), false, "an absent preference muted a first visit");

setMuted(true, storage);
assert.equal(readMuted(storage), true, "muting did not survive a reload");
setMuted(false, storage);
assert.equal(readMuted(storage), false, "unmuting did not survive a reload");

// Safari private mode throws on setItem. The click must still mute the
// session even when it cannot be remembered.
const broken = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
assert.doesNotThrow(() => setMuted(true, broken), "a storage failure broke the mute button");
assert.equal(readMuted(broken), false);
console.log("OK: mute preference defaults to sound on, persists, and survives a storage failure");

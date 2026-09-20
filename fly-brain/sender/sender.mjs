// Signs and submits fly_brain transactions to Thru, one long-lived process instead of a CLI run per
// transaction. The CLI path costs ~2.4 s a row, nearly all of it process startup and waiting for
// execution; here the client and the key stay loaded and a row is built, signed and submitted in place.
//
// Protocol: one JSON object per line on stdin, one per line on stdout.
//   in   {"id": 1, "accounts": ["ta...", "ta..."], "data": "<hex>"}
//   out  {"id": 1, "signature": "ts...", "executed": true,  "nonce": "1814"}   on the chain
//        {"id": 1, "signature": "ts...", "executed": false, "error": "..."}    ran and failed
//        {"id": 1, "executed": false, "error": "..."}                          never ran
//   Every reply carries "executed": a row is only counted when it is true.
//   in   {"id": 2, "op": "ping"}   ->  {"id": 2, "ok": true, "feePayer": "ta..."}
//   in   {"id": 3, "op": "batch", "rows": [{"accounts": [...], "data": "<hex>"}, ...]}
//   out  {"id": 3, "landed": 30, "count": 32, "results": [...]}   landed = the leading run that
//        executed, in order; the caller re-reads the chain when it is short of count.
//
// The signing key is read at startup from THRU_SECRET_KEY (64 hex characters) or, failing that, from
// the CLI's own config (~/.thru/cli/config.yaml, the `keys:` entry named by THRU_KEY_NAME or
// "default"). It is never logged or echoed.
//
// Ordering: the fly_brain program requires each row to carry the next index, so rows must execute in
// order. Transactions are submitted in the order given, each with the next fee-payer nonce, which is
// what the chain orders them by. The nonce is allocated here rather than left to the builder's own
// account read: that read can lag the row just executed, and one stale nonce rejects every row after
// it (TRANSACTION_VM_ERROR_NONCE_TOO_LOW). Only one process may submit for this key at a time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { createThruClient, TransactionVmError } from "@thru/sdk";

const RPC = process.env.THRU_RPC ?? "https://rpc.alphanet.thru.org";
const KEY_NAME = process.env.THRU_KEY_NAME ?? "default";
const CONFIG = path.join(os.homedir(), ".thru", "cli", "config.yaml");

function secretKey() {
  const fromEnv = process.env.THRU_SECRET_KEY;
  if (fromEnv) return Buffer.from(fromEnv.trim(), "hex");
  // the CLI's config is a small YAML file; read only the one key we need, and never print it
  const text = fs.readFileSync(CONFIG, "utf8");
  const keys = text.split(/^keys:\s*$/m)[1];
  const hit = keys && keys.match(new RegExp(`^\\s+${KEY_NAME}:\\s*([0-9a-fA-F]{64})\\s*$`, "m"));
  if (!hit) throw new Error(`no key ${KEY_NAME} in ${CONFIG} and no THRU_SECRET_KEY`);
  return Buffer.from(hit[1], "hex");
}

const thru = createThruClient({ baseUrl: RPC });
const privateKey = new Uint8Array(secretKey());
const publicKey = Buffer.from(await thru.keys.fromPrivateKey(privateKey)).toString("hex");
// THRU_FEE_PAYER is a ta... address (what the deployment record holds); the fallback is this key's
// own public key as hex. The SDK takes either form wherever a PubkeyInput is expected.
const feePayer = process.env.THRU_FEE_PAYER ?? publicKey;
const program = process.env.THRU_PROGRAM;
if (!program) throw new Error("THRU_PROGRAM is required (the fly_brain program address)");

// Allocates each row's fee-payer nonce and applies the node's correction when a row is rejected for
// one. A nonce reject does not consume the nonce, so retrying with the reported value is free.
const nonces = thru.nonce.createFeePayerManager(feePayer);
const NONCE_RETRIES = 3;

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

// Signatures and execution results come back as domain objects; keep the readable parts.
const signatureText = (sig) =>
  typeof sig === "string" ? sig : (sig?.toThruFmt?.() ?? sig?.toHex?.() ?? "");
const summarize = (result) =>
  Object.fromEntries(Object.entries(result ?? {})
    .filter(([, v]) => ["string", "number", "bigint", "boolean"].includes(typeof v))
    .map(([k, v]) => [k, typeof v === "bigint" ? String(v) : v]));

// A row counts as landed only when the VM ran it and the program returned no error. vmError carries
// the runtime's own rejections (a bad nonce, an expired transaction) and is where a rejected row
// shows up: it is reported at the same place as a success, so anything that does not check it reads
// every rejection as a win. userErrorCode carries fly_brain's own failures, such as a row index that
// does not match the brain's count.
const isZero = (code) => code === undefined || code === null ||
  code === 0 || code === 0n || /^(0x)?0+$/i.test(String(code));

function verdict(result) {
  const vmError = Number(result.vmError ?? 0);
  if (vmError !== 0) {
    return `${TransactionVmError[vmError] ?? "vm error"} (${vmError})`;
  }
  if (!isZero(result.userErrorCode)) {
    return `program error ${result.userErrorCode}`;
  }
  return null;              // executed, and the program was happy
}

const build = ({ accounts = [], data }, nonce) => thru.transactions.buildAndSign({
  feePayer: { publicKey: feePayer, privateKey },
  program,
  accounts: { readWrite: accounts },
  instructionData: Buffer.from(data, "hex"),
  header: { fee: 0n, nonce },
});

async function attempt(accounts, data, nonce) {
  const { rawTransaction, signature } = await build({ accounts, data }, nonce);
  for await (const update of thru.transactions.sendAndTrack(rawTransaction, { timeoutMs: 30_000 })) {
    // the tracked update carries an empty Signature object, so keep the one we signed with
    if (update.executionResult) return { signature, result: update.executionResult };
  }
  return { signature, result: null };
}

// Each row waits for the node to execute it before the reply is written. The fly_brain program
// requires each row to carry the next index, so a row submitted before its predecessor executes is
// rejected; waiting is what makes a sequential run land every row, and it is the only way the caller
// learns whether a row is really on the chain.
async function submit({ id, accounts = [], data }) {
  for (let tries = 0; ; tries++) {
    const { nonces: [nonce] } = await nonces.allocate(1);
    const { signature, result } = await attempt(accounts, data, nonce);
    if (!result) {
      // the nonce was allocated and may never be spent. Left alone that is a hole, and every later
      // row sits above it (NONCE_TOO_HIGH), so put the cursor back where the chain actually is.
      await nonces.sync().catch(() => {});
      out({ id, executed: false, error: "no execution result before the timeout" });
      return;
    }
    // a nonce reject leaves the nonce unspent: take the node's number and send the row again
    if (nonces.applyNonceReject(result) && tries < NONCE_RETRIES) continue;
    const problem = verdict(result);
    out({ id, signature: signatureText(signature), executed: !problem, nonce: String(nonce),
          ...(problem ? { error: problem, result: summarize(result) } : {}) });
    return;
  }
}

// A whole run of rows in one go. Waiting for each row to execute costs a slot apiece (about a
// second), which is the wrong price for 114k rows. The runtime orders a fee payer's transactions by
// nonce, so a block of rows signed with consecutive nonces executes in the order it was built: each
// row still sees its predecessor's state, which is what the program's row-index check requires.
//
// Only a leading run of successes can be counted. If row k fails, every row after it saw a count
// the program did not expect, so the caller re-reads the chain and starts again from there.
const BATCH_TIMEOUT_MS = 90_000;

async function submitBatch({ id, rows }) {
  const { nonces: allocated } = await nonces.allocate(rows.length);
  const signed = [];
  for (const [i, row] of rows.entries()) signed.push(await build(row, allocated[i]));

  const results = await thru.transactions.batchSendAndTrack(
    signed.map((s) => s.rawTransaction), { trackTimeoutMs: BATCH_TIMEOUT_MS });

  // rows that never executed leave their nonces unspent: resync rather than send the next batch
  // into the hole they left
  if (results.some((r) => !r.executionResult)) await nonces.sync().catch(() => {});

  let landed = 0;
  const report = results.map((r, i) => {
    const problem = r.executionResult ? verdict(r.executionResult)
                                      : `not executed (${r.trackStatus ?? "no result"})`;
    if (!problem && landed === i) landed++;
    return { signature: signatureText(signed[i]?.signature), executed: !problem,
             nonce: String(allocated[i]), ...(problem ? { error: problem } : {}) };
  });
  // the first nonce reject is the one that tells us where the chain actually is
  for (const r of results) if (nonces.applyNonceReject(r.executionResult)) break;
  out({ id, landed, count: rows.length, results: report });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
out({ ready: true, rpc: RPC, feePayer, program });
for await (const line of rl) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch (e) {
    out({ error: `bad request: ${e.message}` });
    continue;
  }
  try {
    if (request.op === "ping") out({ id: request.id, ok: true, feePayer, program });
    else if (request.op === "batch") await submitBatch(request);
    else await submit(request);
  } catch (e) {
    out({ id: request.id, error: String(e?.message ?? e).slice(0, 300) });
  }
}

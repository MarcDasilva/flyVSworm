// The fly's signing path. One synaptic event, one signed alphanet
// transaction, exactly as the worm settles its own — see synapses.mjs, whose
// connection, key and nonce manager this shares.
//
// What differs, and it matters: the worm's events are produced BY the chain
// (worm.c integrates the membrane equation and fills an on-chain outbox), so
// the program can check every event against it. The fly's spiking model runs
// in fly-brain/python and the browser derives its synaptic events from the
// model's own spikes and weight matrix, so program/fly.c can only record what
// it is handed. The ledger movement and the receipt are real; the arithmetic
// behind them happened off chain. Do not describe this as an on-chain fly.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createThruClient, Pubkey } from "@thru/sdk";
import { nativeSigningKey, signSynapse, SYNAPSE_FEE } from "./synapses.mjs";

const cfg = JSON.parse(readFileSync(new URL("../data/fly.json", import.meta.url)));

/**
 * The fly signs with its OWN fee payer, deliberately not the worm's.
 *
 * One account is one nonce sequence. The worm settles its outbox in batches of
 * a thousand-odd transactions and holds that whole nonce range in flight for
 * seconds; a fly transaction allocated from the same account lands ABOVE the
 * gap and never executes — submitted, charged nothing, silently absent from
 * the chain. That was measured, not guessed: eight fly transactions through
 * the shared payer produced zero events, and the same eight through a payer of
 * their own produced eight. Two animals, two payers.
 *
 * Top it up with: thru faucet withdraw --fee-payer worm default 10000
 */
const FEE_PAYER_KEY = "default";
/** Leave the fly's payer enough to finish whatever is already in flight. */
export const FLY_BALANCE_FLOOR = 2_000;

/** Model weights are ~0.007 to 0.17; this is what turns one into whole units
 *  of balance. Small on purpose — every unit moved is a unit the accounts
 *  created by pipeline/deploy_fly.py had to be funded with. */
export const UNITS = 100;
/** Most events settled per submission. The model spikes at 1000 ticks/s and
 *  the chain confirms in ~2 s, so this is a CEILING on spend, not a target —
 *  see the note on sampling in web/src/flychain.ts. */
export const BATCH_MAX = 24;

/** One event -> the 24 instruction bytes program/fly.c's do_synapse reads. */
export function synapseInstruction(slot, event) {
  const data = Buffer.alloc(24);
  data.writeUInt32LE(2, 0);                     // FLY_INSTR_SYNAPSE
  data.writeUInt32LE(event.tick >>> 0, 4);
  data.writeUInt16LE(slot(cfg.reservoirAccount), 8);
  data.writeUInt16LE(slot(cfg.accounts[event.pre]), 10);
  data.writeUInt16LE(slot(cfg.accounts[event.post]), 12);
  data.writeUInt16LE(event.pre, 14);
  data.writeUInt16LE(event.post, 16);
  data.writeInt32LE(event.amount, 18);
  data.writeUInt8(event.amount < 0 ? 1 : 0, 22); // inhibitory: charge leaves post
  return data;
}

/** Rejects an event the program would revert on, BEFORE it costs a fee. */
export function validEvent(e) {
  return Number.isInteger(e?.pre) && Number.isInteger(e?.post) &&
    e.pre >= 0 && e.pre < cfg.accounts.length &&
    e.post >= 0 && e.post < cfg.accounts.length && e.pre !== e.post &&
    Number.isInteger(e.amount) && e.amount !== 0 && Math.abs(e.amount) < 1_000_000 &&
    Number.isInteger(e.tick) && e.tick >= 0;
}

let signer;
async function connect() {
  const thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 15_000 } });
  const { stdout } = await promisify(execFile)("thru", ["--json", "keys", "get", FEE_PAYER_KEY]);
  const secret = JSON.parse(stdout).keys.value;
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw Error("Invalid fly signing key format");
  const privateKey = Buffer.from(secret, "hex");
  const publicKey = Pubkey.from(await thru.keys.fromPrivateKey(privateKey));
  return { thru, feePayer: { publicKey }, key: nativeSigningKey(privateKey),
           chainId: await thru.chain.getChainId(),
           nonces: thru.nonce.createFeePayerManager(publicKey) };
}

export async function closeFlySynapses() {
  if (signer) (await signer).nonces.close();
}

/**
 * Submit up to BATCH_MAX events, one transaction each. Returns the
 * signatures; the BROWSER reads the confirmed receipts back off the chain
 * itself (src/flychain.ts), so nothing here waits for confirmation.
 */
/** The last batch sent, so the next call can check whether it ever executed.
 *  See resync — this is the whole self-healing mechanism. */
let lastBatch;

/**
 * A batch that never executes strands EVERY later transaction: the manager's
 * counter has moved past the gap and the chain is still waiting for it to be
 * filled, so nothing after it can ever run. batchSend reports transport, not
 * execution, so nothing upstream sees this happen — the fly goes on submitting
 * and the panel goes quiet with no error anywhere. The fix is to look at the
 * PREVIOUS batch before sending the next one and re-read the chain's own nonce
 * when it went missing. The worm gets this for free by confirming every batch;
 * the fly cannot afford to wait, so it checks one signature, one batch late.
 */
async function resync(thru, nonces) {
  if (!lastBatch || Date.now() - lastBatch.at < 4000) return;
  const [sig] = lastBatch.signatures;
  lastBatch = undefined;
  // A stranded transaction is not ABSENT — the node records it as failed with
  // a nonce error (-510 seen on alphanet under load), so presence alone
  // proves nothing. Only a clean execution leaves the counter alone.
  let executed = false;
  try {
    const result = (await thru.transactions.get(sig)).executionResult;
    executed = result?.vmError === 0 && result.executionResult === 0n;
  } catch { /* not indexed: same answer */ }
  if (!executed) {
    console.error(`fly synapses: ${sig.slice(0, 12)}… did not execute — resyncing the nonce`);
    nonces.reset();
  }
}

export async function settleFlySynapses(events, floor = FLY_BALANCE_FLOOR) {
  signer ??= connect();
  const { thru, feePayer, key, chainId, nonces } = await signer;
  await resync(thru, nonces);
  const batch = events.filter(validEvent).slice(0, BATCH_MAX);
  if (!batch.length) return { submitted: 0, balance: undefined };
  const [payer, height] = await Promise.all([
    thru.accounts.get(feePayer.publicKey), thru.blocks.getBlockHeight(),
  ]);
  if (!payer.meta) throw Error("Fly fee payer account is missing — see FEE_PAYER_KEY");
  const canSpend = Number((payer.meta.balance - BigInt(floor)) / SYNAPSE_FEE);
  if (canSpend <= 0) return { submitted: 0, balance: Number(payer.meta.balance) };
  const sending = batch.slice(0, Math.min(batch.length, canSpend));
  const allocation = await nonces.allocate(sending.length);
  try {
    const transactions = await Promise.all(sending.map(async (event, i) => {
      const accounts = [cfg.reservoirAccount, cfg.accounts[event.pre], cfg.accounts[event.post]];
      const transaction = await thru.transactions.build({
        feePayer, program: cfg.programId,
        header: { nonce: allocation.nonces[i], startSlot: height.finalized,
          chainId, fee: SYNAPSE_FEE, computeUnits: 200_000, expiryAfter: 300 },
        accounts: { readWrite: [...new Set(accounts)] },
        instructionData: async ({ getAccountIndex }) => synapseInstruction(getAccountIndex, event),
      });
      return signSynapse(transaction, key);
    }));
    await thru.transactions.batchSend(transactions.map(t => t.rawTransaction), { numRetries: 0 });
    const signatures = transactions.map(t => t.signature.toThruFmt());
    lastBatch = { signatures, at: Date.now() };
    // Same line the worm's settler prints, and the thread back to a batch that
    // quietly went nowhere.
    console.error(`fly synapses: sent ${sending.length} at nonce ${allocation.baseNonce}, ` +
                  `first ${signatures[0]}`);
    return { submitted: sending.length, signatures,
             balance: Number(payer.meta.balance) - sending.length };
  } catch (error) {
    lastBatch = undefined;
    nonces.reset();   // An ambiguous send leaves the allocation unusable.
    throw error;
  }
}

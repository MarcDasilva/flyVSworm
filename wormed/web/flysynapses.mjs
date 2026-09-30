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
 * And the same rule is the fly's own ceiling: one payer lands about 100 transactions a second
 * because each batch must settle before the next (see settled). So the fly has a POOL of
 * payers, one nonce sequence each, and the relay runs one settle loop per payer in parallel —
 * measured ~94/s on one, and the pool scales by count until alphanet itself is the limit.
 * A new payer is `thru account create <name>` then the faucet; refillFlyPayer keeps it topped
 * up after that. By hand: thru faucet withdraw --fee-payer <name> <name> 10000
 *
 * NOT `default`. It is the CLI's implicit fee payer, so anything run by hand and the worm's
 * own faucet refill (pipeline/deploy.py) spend its nonces outside a manager — 20 of 54 batches
 * on it failed NONCE_TOO_LOW, and the worm's refills failed the other way.
 */
export const FLY_PAYERS = ["fly1", "fly2", "fly3", "fly4"];
/** Leave the fly's payer enough to finish whatever is already in flight. */
export const FLY_BALANCE_FLOOR = 2_000;
/** Refill below this. One faucet call is 10,000 (its cap) and lands in ~3 s, so the threshold
 *  covers the batches sent while it is in flight — at BATCH_MAX a second, 20,000 is over a
 *  minute of spend. The relay throttles the calls, not the faucet. */
export const FLY_REFILL_AT = 20_000;
const REFILL_EVERY_MS = 15_000;

/** Model weights are ~0.007 to 0.17; this is what turns one into whole units
 *  of balance. Small on purpose — every unit moved is a unit the accounts
 *  created by pipeline/deploy_fly.py had to be funded with. */
export const UNITS = 100;
/** Most events settled per submission. The model produces ~14,000 events a
 *  second and the relay submits once a second, so this is the fly's rate and a
 *  CEILING on its spend — and the faucet's 10,000 per 15 s is the real limit
 *  on how high it can go (FLY_REFILL_AT). What settles is a sample. */
export const BATCH_MAX = 250;

/** The model's own weight matrix, as outgoing edges in whole ledger units. An edge that
 *  rounds to zero units can never be a transaction and is dropped here rather than rejected
 *  on chain. Self-edges too: program/fly.c reverts on pre == post. */
export function outgoingEdges(synapses) {
  const out = new Map();
  for (const [pre, post, w] of synapses) {
    const amount = Math.round(w * UNITS);
    if (!amount || pre === post) continue;
    const list = out.get(pre) ?? [];
    list.push({ post, amount });
    out.set(pre, list);
  }
  return out;
}

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

/**
 * Tops the fly's payer up from the faucet, self-paid. The CLI spends one of this payer's
 * nonces outside the SDK's manager, so the manager MUST be reset after — a batch built on the
 * stale count is rejected with NONCE_TOO_LOW and settles nothing. Throttled: the faucet call
 * takes ~3 s to land and a second one before that would only pay another fee.
 */
export async function refillFlyPayer(signer) {
  if (Date.now() - signer.lastRefill < REFILL_EVERY_MS) return false;
  signer.lastRefill = Date.now();
  // --fee-payer is load-bearing: the CLI otherwise charges `default`, which is ANOTHER pool
  // signer, and that spends one of its nonces behind its manager — 11 of 42 default batches
  // failed NONCE_TOO_LOW before this was explicit.
  await promisify(execFile)("thru", ["--json", "faucet", "withdraw", "--fee-payer", signer.name,
                                     signer.name, "10000"]);
  signer.nonces.reset();
  return true;
}

/** One connection per payer name, made on first use. */
const signers = new Map();
async function connect(name) {
  const thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 15_000 } });
  const { stdout } = await promisify(execFile)("thru", ["--json", "keys", "get", name]);
  const secret = JSON.parse(stdout).keys.value;
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw Error(`Invalid fly signing key format for ${name}`);
  const privateKey = Buffer.from(secret, "hex");
  const publicKey = Pubkey.from(await thru.keys.fromPrivateKey(privateKey));
  return { name, thru, feePayer: { publicKey }, key: nativeSigningKey(privateKey),
           chainId: await thru.chain.getChainId(),
           nonces: thru.nonce.createFeePayerManager(publicKey), lastRefill: 0 };
}

export async function closeFlySynapses() {
  for (const signer of signers.values()) (await signer).nonces.close();
}

/**
 * Waits for the chain's nonce to reach the end of the batch just sent — the worm confirms
 * every batch before the next (synapses.mjs) and the fly has to as well: a batch pipelined
 * behind one the node dropped is rejected whole with NONCE_TOO_HIGH, and at one batch a
 * second that strands everything until someone notices (measured: 13 of 46 batches).
 * "Dropped" is judged by the nonce STANDING STILL, not by a deadline: under load a 250-batch
 * has taken over 20 s to land, and a deadline reset the manager to a count those late
 * transactions then moved past, so the next batch failed NONCE_TOO_LOW (measured 2 in 34).
 * Only when nothing has moved for STALL_MS are the missing ones treated as gone and the
 * manager re-read from the chain.
 */
const STALL_MS = 10_000;
async function settled(thru, feePayer, nonces, end) {
  let seen = -1n, movedAt = Date.now();
  for (;;) {
    const { meta } = await thru.accounts.get(feePayer.publicKey);
    const nonce = meta?.nonce ?? -1n;
    if (nonce >= end) return true;
    if (nonce !== seen) { seen = nonce; movedAt = Date.now(); }
    else if (Date.now() - movedAt > STALL_MS) {
      console.error(`fly synapses: chain nonce stuck at ${nonce}, short of ${end} — resyncing`);
      nonces.reset();
      return false;
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Submit up to BATCH_MAX events, one transaction each, and return once the chain has taken
 * them (settled). The BROWSER reads the confirmed receipts back off the chain itself
 * (src/flychain.ts); the wait here is for the NONCE, not the receipts.
 */
export async function settleFlySynapses(events, payerName = FLY_PAYERS[0], floor = FLY_BALANCE_FLOOR) {
  if (!signers.has(payerName)) signers.set(payerName, connect(payerName));
  const signer = await signers.get(payerName);
  const { thru, feePayer, key, chainId, nonces } = signer;
  const batch = events.filter(validEvent).slice(0, BATCH_MAX);
  if (!batch.length) return { submitted: 0, balance: undefined };
  const [payer, height] = await Promise.all([
    thru.accounts.get(feePayer.publicKey), thru.blocks.getBlockHeight(),
  ]);
  if (!payer.meta) throw Error(`Fly fee payer ${signer.name} is missing — see FLY_PAYERS`);
  if (payer.meta.balance < BigInt(FLY_REFILL_AT) && await refillFlyPayer(signer)) {
    console.error(`fly synapses: ${signer.name} at ${payer.meta.balance}, refilled from the faucet`);
    return { submitted: 0, balance: Number(payer.meta.balance) };
  }
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
    // Same line the worm's settler prints, and the thread back to a batch that
    // quietly went nowhere.
    console.error(`fly synapses: ${signer.name} sent ${sending.length} at nonce ${allocation.baseNonce}, ` +
                  `first ${signatures[0]}`);
    await settled(thru, feePayer, nonces, allocation.baseNonce + BigInt(sending.length));
    return { submitted: sending.length, signatures,
             balance: Number(payer.meta.balance) - sending.length };
  } catch (error) {
    nonces.reset();   // An ambiguous send leaves the allocation unusable.
    throw error;
  }
}

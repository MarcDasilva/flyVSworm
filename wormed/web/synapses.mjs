// Server-only signing path. A bulk RPC contains independently signed
// transactions, each executing exactly one persisted synaptic event.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPrivateKey, sign } from "node:crypto";
import { buildTransactionSigningMessage, createThruClient, Filter, FilterParamValue, PageRequest, Pubkey, Signature } from "@thru/sdk";

const MAGIC = 0x53594e50;
export const SYNAPSE_FEE = 1n;

export function decodeOutbox(bytes) {
  if (!bytes || bytes.length < 16) throw Error("Synapse outbox is missing; upgrade and initialize the program");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = data.getUint32(0, true);
  if (magic === 0) return { generation: 0, entries: [] };
  const count = data.getUint32(4, true), remaining = data.getUint32(8, true);
  if (magic !== MAGIC || count > 32768 || bytes.length < 16 + count * 16)
    throw Error("Invalid synapse outbox");
  const entries = [];
  for (let index = 0; index < count; index++) {
    const at = 16 + index * 16;
    const entry = { index, step: data.getUint32(at, true),
      pre: data.getUint16(at + 4, true), post: data.getUint16(at + 6, true),
      amount: data.getInt32(at + 8, true), kind: data.getUint8(at + 12) };
    const settled = data.getUint8(at + 13);
    if (entry.pre >= 302 || entry.post >= 302 || !entry.amount || entry.kind > 1 || settled > 1)
      throw Error(`Invalid synapse entry ${index}`);
    if (!settled) entries.push(entry);
  }
  if (entries.length !== remaining) throw Error("Synapse outbox count mismatch");
  return { generation: data.getUint32(12, true), entries };
}

export function settleInstruction(generation, index, reservoir, pre, post) {
  const data = Buffer.alloc(20);
  data.writeUInt32LE(8, 0);
  data.writeUInt32LE(generation, 4);
  data.writeUInt32LE(index, 8);
  data.writeUInt16LE(reservoir, 12);
  data.writeUInt16LE(pre, 14);
  data.writeUInt16LE(post, 16);
  return data;
}

let signer, outbox;
export function nativeSigningKey(seed) {
  if (seed.length !== 32) throw Error("Signing seed must be 32 bytes");
  return createPrivateKey({ key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"), seed,
  ]), format: "der", type: "pkcs8" });
}

export function signSynapse(transaction, key) {
  // SDK owns the exact domain-separated message; Node supplies Ed25519.
  // Measured 500 signatures: 41 ms native versus 239 ms in the JS signer.
  const message = buildTransactionSigningMessage(transaction.toWireForSigning());
  const signature = Signature.from(sign(null, message.m, key));
  transaction.setSignature(signature);
  return { signature, rawTransaction: transaction.toWire() };
}

async function connect() {
  const cfg = JSON.parse(readFileSync(new URL("../data/chain.json", import.meta.url)));
  const addresses = JSON.parse(readFileSync(new URL("../data/addresses.json", import.meta.url)));
  const thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 15_000 } });
  const { stdout } = await promisify(execFile)("thru", ["--json", "keys", "get", "worm"]);
  const secret = JSON.parse(stdout).keys.value;
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw Error("Invalid relay signing key format");
  const privateKey = Buffer.from(secret, "hex");
  const key = nativeSigningKey(privateKey);
  const publicKey = Pubkey.from(await thru.keys.fromPrivateKey(privateKey));
  const chainId = await thru.chain.getChainId();
  // One shared event stream: opening one tracker per transaction on this
  // alphanet times out even when every transaction has executed successfully.
  const confirmed = new Set(), controller = new AbortController();
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        for await (const { event } of thru.events.stream({ signal: controller.signal })) {
          if (!event.transactionSignature || !event.program || !event.payload) continue;
          if (!Pubkey.from(event.program).equals(Pubkey.from(cfg.programId))) continue;
          if (Buffer.from(event.payload.subarray(0, 8)).toString() !== "WORMSYNX") continue;
          confirmed.add(Signature.from(event.transactionSignature).toThruFmt());
          if (confirmed.size > 4096) confirmed.delete(confirmed.values().next().value);
        }
      } catch { /* Reconnect; missed confirmations are queried below. */ }
      if (!controller.signal.aborted) await new Promise(r => setTimeout(r, 1000));
    }
  })();
  const nonces = thru.nonce.createFeePayerManager(publicKey);
  return { cfg, addresses, thru, feePayer: { publicKey }, key, chainId, confirmed, controller, nonces };
}

export async function closeSynapses() {
  if (signer) {
    const connected = await signer;
    connected.controller.abort();
    connected.nonces.close();
  }
}

export async function confirmSynapses(thru, program, signatures, confirmed, startSlot) {
  // Recover missed stream receipts in pages, not thousands of individual RPCs.
  const missing = new Set(signatures.filter(sig => !confirmed.has(sig)));
  const filter = new Filter({
    expression: `event.slot >= uint(${startSlot}) && event.program.value == params.address && bytesPrefix(event.payload, params.prefix)`,
    params: { address: FilterParamValue.pubkey(program), prefix: FilterParamValue.bytes(Buffer.from("WORMSYNX")) },
  });
  let pageToken;
  // The event index can lag or return a non-advancing cursor. Bound recovery
  // before asking the transaction index about the remaining signatures.
  for (let pages = 0; missing.size && pages < 8; pages++) {
    const page = await thru.events.list({ filter, page: new PageRequest({ pageSize: 1000, pageToken }) });
    for (const event of page.events) {
      if (!event.transactionSignature) continue;
      const sig = Signature.from(event.transactionSignature).toThruFmt();
      if (missing.delete(sig)) confirmed.add(sig);
    }
    const next = page.page?.nextPageToken;
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  // Missing receipts may be failed transactions or a lagging event index.
  const rest = [...missing];
  for (let start = 0; start < rest.length; start += 8) {
    await Promise.all(rest.slice(start, start + 8).map(async sig => {
      const transaction = await thru.transactions.get(sig);
      const result = transaction.executionResult;
      if (result?.vmError !== 0 || result.executionResult !== 0n || result.eventsCount !== 1)
        throw Error(`Synapse ${sig} failed: VM ${result?.vmError}, code ${result?.userErrorCode}`);
      confirmed.add(sig);
    }));
  }
}

export async function settleSynapses({ floor, onReceipt, batchSize = 2048 }) {
  signer ??= connect();
  const { cfg, addresses, thru, feePayer, key, chainId, confirmed, nonces } = await signer;
  if (!outbox) {
    const account = await thru.accounts.get(cfg.reservoirAccount);
    outbox = decodeOutbox(account.data?.data);
  }
  const [payer, height] = await Promise.all([
    thru.accounts.get(feePayer.publicKey), thru.blocks.getBlockHeight(),
  ]);
  if (!payer.meta) throw Error("Fee payer metadata is missing");
  const canSpend = Number((payer.meta.balance - BigInt(floor)) / SYNAPSE_FEE);
  const batch = outbox.entries.slice(0, Math.max(0, Math.min(batchSize, canSpend)));
  if (canSpend <= 0)
    return { remaining: outbox.entries.length, balance: Number(payer.meta.balance) };
  if (!batch.length) {
    outbox = undefined;
    return { remaining: 0, balance: Number(payer.meta.balance) };
  }
  const started = Date.now();
  let signatures;
  try {
    const allocation = await nonces.allocate(batch.length);
    const transactions = await Promise.all(batch.map(async (entry, i) => {
      const pre = addresses[entry.pre], post = addresses[entry.post];
      const transaction = await thru.transactions.build({
        feePayer, program: cfg.programId,
        header: { nonce: allocation.nonces[i], startSlot: height.finalized,
          chainId, fee: SYNAPSE_FEE, computeUnits: 200_000, expiryAfter: 300 },
        accounts: { readWrite: [...new Set([cfg.reservoirAccount, pre, post])] },
        instructionData: async ({ getAccountIndex: slot }) => settleInstruction(
          outbox.generation, entry.index, slot(cfg.reservoirAccount), slot(pre), slot(post)),
      });
      return signSynapse(transaction, key);
    }));
    signatures = transactions.map(t => t.signature.toThruFmt());
    console.error(`synapses: submitting ${batch.length} events (nonce ${allocation.baseNonce})`);
    await thru.transactions.batchSend(transactions.map(t => t.rawTransaction), { numRetries: 0 });
    console.error(`synapses: submitted in ${Date.now() - started} ms`);
    const deadline = Date.now() + 2000;
    while (signatures.some(sig => !confirmed.has(sig)) && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 25));
    await confirmSynapses(thru, cfg.programId, signatures, confirmed, height.finalized);
    console.error(`synapses: confirmed ${batch.length} events in ${Date.now() - started} ms`);
  } catch (error) {
    outbox = undefined; // Reload persisted flags before retrying an ambiguous send.
    nonces.reset();
    throw error;
  }
  signatures.forEach((sig, i) => {
    onReceipt({ op: batch[i].kind ? "chemical" : "electrical", sig,
      ms: Date.now() - started, ...batch[i] });
    confirmed.delete(sig);
  });
  outbox.entries.splice(0, batch.length);
  const remaining = outbox.entries.length;
  if (!remaining) outbox = undefined;
  return { remaining, balance: Number(payer.meta.balance - SYNAPSE_FEE * BigInt(batch.length)) };
}

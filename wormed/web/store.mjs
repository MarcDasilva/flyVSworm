// The exhibit's ledger. The chain says what happened; this says what the ROOM shows — the
// standings sheet on the board and the transaction total over it. Both have to survive a page
// reload, a relay restart and the gap between two demos, and neither can live in the browser
// for that reason.
//
// node:sqlite, so the exhibit gains no dependency and the whole ledger is one file to copy or
// delete. Everything here is synchronous on purpose: the relay writes one row per transaction
// from inside its logging path, and a promise there would reorder the log.
import { DatabaseSync } from "node:sqlite";

/** The only rows the board will ever rank. Anything else posted to the relay is refused — this
 *  is a two-specimen exhibit, and an open scoreboard is a way for a visitor to write on the
 *  wall. See recordStanding. */
export const SPECIMENS = ["fly", "worm"];

/** Ledger file. EXHIBIT_DB overrides it; tests pass ":memory:" so a run leaves nothing behind. */
export const DEFAULT_DB = fileFromUrl(new URL("../data/exhibit.db", import.meta.url));

function fileFromUrl(url) {
  return decodeURIComponent(url.pathname);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS standing (
    specimen TEXT PRIMARY KEY,
    profit   REAL    NOT NULL,
    trades   INTEGER NOT NULL,
    updated  INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS tally (
    name  TEXT    PRIMARY KEY,
    count INTEGER NOT NULL
  ) STRICT;
  INSERT OR IGNORE INTO tally (name, count) VALUES ('transactions', 0);
`;

/** Bounds on a posted standing. Wide enough for any paper book the exhibit can produce, narrow
 *  enough that a bad or hostile post cannot print a screenful of digits on the board. */
const PROFIT_LIMIT = 1e9;
const TRADE_LIMIT = 1e9;

/**
 * Opens the ledger, creating it on first run. Throws if the file cannot be opened — the caller
 * decides whether an exhibit without a ledger is still worth running (relay.mjs says yes).
 */
export function openStore(file = process.env.EXHIBIT_DB || DEFAULT_DB) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const bump = db.prepare("UPDATE tally SET count = count + ? WHERE name = 'transactions'");
  const upsert = db.prepare(`INSERT INTO standing (specimen, profit, trades, updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(specimen) DO UPDATE SET
      profit = excluded.profit, trades = excluded.trades, updated = excluded.updated`);
  const tally = db.prepare("SELECT count FROM tally WHERE name = 'transactions'");
  const standings = db.prepare(
    "SELECT specimen, profit, trades, updated FROM standing ORDER BY profit DESC");

  return {
    /** One per transaction the relay has SUBMITTED, ever. Counted where the relay logs its
     *  receipts, which is the ONE place both the worker's transactions and the synapse batches
     *  pass through — see note() in relay.mjs. */
    countTransactions(n = 1) {
      bump.run(Math.max(0, Math.floor(n)));
    },

    /**
     * The latest standing for one animal. TRUST BOUNDARY: this is reached straight from a POST,
     * so the specimen must be one of the two the exhibit has and the figures must be numbers in
     * a range a board can print. Returns false on anything else; the relay answers 400.
     */
    recordStanding(specimen, profit, trades) {
      if (!SPECIMENS.includes(specimen)) return false;
      if (!Number.isFinite(profit) || Math.abs(profit) > PROFIT_LIMIT) return false;
      if (!Number.isFinite(trades) || trades < 0 || trades > TRADE_LIMIT) return false;
      upsert.run(specimen, profit, Math.floor(trades), Date.now());
      return true;
    },

    /** The board, ranked. Best profit first — the sheet prints it in this order. */
    board() {
      return {
        transactions: Number(tally.get()?.count ?? 0),
        standings: standings.all().map(row => ({
          specimen: row.specimen, profit: row.profit,
          trades: Number(row.trades), updated: Number(row.updated),
        })),
      };
    },

    close() {
      db.close();
    },
  };
}

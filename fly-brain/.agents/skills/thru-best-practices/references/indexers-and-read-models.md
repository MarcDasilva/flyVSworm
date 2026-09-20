# Indexers And Read Models

Use this reference when the task involves:

- indexing chain data
- deciding whether indexing is necessary
- choosing between `@thru/sdk`, `@thru/replay`, and `@thru/indexer`
- backend, replay, or ETL flows
- building a read model or history view
- Postgres-backed queries, joins, filters, or historical analysis

## Package Selection

For backend, indexing, replay, ETL, read-model, and Postgres-backed tasks:

- start package selection at `https://thru.org/docs/sdks/web`
- use the package pages when deciding between `@thru/sdk`, `@thru/replay`, and `@thru/indexer`
- use `https://thru.org/docs/sdks/web-packages/thru-sdk` for direct RPC reads, writes, streams, and app-facing domain models
- use `https://thru.org/docs/sdks/web-packages/replay` for ordered historical plus live feeds without persistence
- use `https://thru.org/docs/sdks/web-packages/indexer` for persistence, checkpoints, schemas, and generated read routes
- treat `https://thru.org/docs/indexing/overview` as supporting context after the package choice is clear

## Default

Do not introduce indexing by default.

Start with:

- direct RPC reads
- direct account reads
- account streaming

for simple apps with one or a few accounts.

## When To Add Indexing

Indexing is a better fit when the product needs:

- history
- joins across multiple entities
- filtering or search over many records
- a Postgres-backed read model
- analytical or replay-driven views

## Scope Control

If the user only asked for a simple counter, balance, or single-account realtime page, do not jump straight to an indexer.
Use direct RPC reads or account streaming first, and only add indexing if the requested UI needs history, search, joins, filtering, or analytics.

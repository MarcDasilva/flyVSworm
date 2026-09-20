---
name: thru-best-practices
description: "Use this when building on Thru: writing, testing, deploying, or QAing C programs such as counters; creating or validating ABIs; wiring Next.js or React frontends; embedded wallet connect/signTransaction UX; backend integrations; indexing; Explorer MCP debugging; or choosing Thru CLI and SDK packages. Routes agents to current public docs and durable Thru guardrails."
---

# Thru Best Practices

Use this skill as a thin router and guardrail layer for Thru development.

Do not treat this skill as a replacement for the docs site. The source of truth for current syntax, package behavior, and newly added features is `https://thru.org/docs`.

## Non-Negotiables

### 1. If you write or change a program, you must also create or update the ABI

Do not treat ABI work as optional when writing a program. If you add or change:

- an instruction format
- an account layout
- an event payload
- a seed or account-derivation contract

then you must also create or update the ABI and validate it.

Use this loop:

```text
write ABI -> analyze -> codegen -> build payload -> reflect it back
```

Do not trust a handwritten ABI just because the YAML looks plausible. Do not call program work complete without ABI validation status.

### 2. After local compilation succeeds, always check live-validation prerequisites

Do not stop at local compilation just because live validation might require more inputs.

After local compilation succeeds, always inspect:

- `.env.local` or equivalent local config
- exported `THRU_*` environment variables
- the active `thru` identity and whether it is actually usable for writes

Then do one of two things:

- if the required config and credentials are present, continue into deployment or live-chain validation
- if they are missing, state exactly which input is missing

Do not assume live credentials or config are absent without checking. A key merely existing is not enough; check whether the selected account is funded or otherwise usable for live writes.

### 3. Do not present Thru work as complete without validation status

For substantial Thru implementation tasks, explicitly state the validation status of:

- program compilation status
- ABI validation status
- live-chain or devnet test status

If any of these were not performed, say so clearly. Do not describe the work as complete. Call it a scaffold, draft, or partially validated implementation instead.
Do not satisfy this rule by stopping early with "not validated" if the local validation steps were available and you did not attempt them.

### 4. For program plus app tasks, finish the program contract first

When the user asks for a C program and a frontend, such as a counter program plus a Next.js UI:

1. write or update the C program and ABI together
2. validate the ABI and build the program
3. inspect live deployment prerequisites and deploy or state the exact missing input
4. wire the frontend against the validated instruction, account, and event shapes
5. run frontend build and browser QA when the app is runnable

Do not invent frontend payload shapes before the ABI has been validated or generated helpers have been considered.

## Read Only The Relevant Reference

Load the smallest reference that matches the task:

- program or ABI work: read [references/programs-and-abi.md](./references/programs-and-abi.md)
- frontend, wallet, or app integration work: read [references/web-apps-and-wallets.md](./references/web-apps-and-wallets.md)
- indexing, replay, ETL, or read-model work: read [references/indexers-and-read-models.md](./references/indexers-and-read-models.md)
- deployment, live validation, or deployed-state debugging: read [references/live-validation-and-debugging.md](./references/live-validation-and-debugging.md)

Do not load every reference by default.

## Canonical Public Docs

- docs home: `https://thru.org/docs`
- build with LLMs: `https://thru.org/docs/getting-started/build-with-an-llm`
- setup the DevKit: `https://thru.org/docs/program-development/setting-up-thru-devkit`
- wallet overview: `https://thru.org/docs/wallet/overview`
- embedded wallet integration: `https://thru.org/docs/wallet/embedded-wallet-integration`
- wallet approval and signing: `https://thru.org/docs/wallet/approval-and-signing`
- wallet troubleshooting: `https://thru.org/docs/wallet/troubleshooting`
- program development lifecycle: `https://thru.org/docs/program-development/program-development-lifecycle`
- build a C program: `https://thru.org/docs/program-development/building-a-c-program`
- C SDK overview: `https://thru.org/docs/sdks/c`
- C SDK common patterns: `https://thru.org/docs/sdks/c-reference/common-patterns`
- C SDK common gotchas: `https://thru.org/docs/sdks/c-reference/common-gotchas`
- ABI overview: `https://thru.org/docs/abi/overview`
- ABI authoring guide: `https://thru.org/docs/abi/authoring-guide`
- ABI examples: `https://thru.org/docs/abi/examples`
- ABI explorer compatibility: `https://thru.org/docs/abi/explorer-compatibility`
- ABI validation and roundtrip testing: `https://thru.org/docs/abi/validation-and-roundtrip-testing`
- ABI publishing and iteration: `https://thru.org/docs/abi/deployment-and-program-testing`
- web SDK overview: `https://thru.org/docs/sdks/web`
- `@thru/sdk`: `https://thru.org/docs/sdks/web-packages/thru-sdk`
- `@thru/wallet/react`: `https://thru.org/docs/sdks/web-packages/wallet`
- `@thru/wallet`: `https://thru.org/docs/sdks/web-packages/wallet`
- `@thru/abi`: `https://thru.org/docs/sdks/web-packages/abi`
- `@thru/indexer`: `https://thru.org/docs/sdks/web-packages/indexer`
- `@thru/replay`: `https://thru.org/docs/sdks/web-packages/replay`
- indexing overview: `https://thru.org/docs/indexing/overview`
- CLI overview: `https://thru.org/docs/cli-reference/overview`
- faucet commands: `https://thru.org/docs/cli-reference/faucet-commands`
- CLI ABI commands: `https://thru.org/docs/cli-reference/abi-commands`
- CLI program commands: `https://thru.org/docs/cli-reference/program-commands`
- CLI transaction commands: `https://thru.org/docs/cli-reference/transaction-commands`
- Explorer MCP overview: `https://thru.org/docs/api-ref/explorer-mcp/overview`
- Explorer MCP tools: `https://thru.org/docs/api-ref/explorer-mcp/tools-reference`

## Current Alphanet Endpoint

Use this as the current default development network endpoint unless the user or environment specifies another network:

- RPC: `https://rpc.alphanet.thru.org`

## Task Router

- If the task is choosing the right Thru surface or doc path, start at `https://thru.org/docs/getting-started/build-with-an-llm`.
- If the task is writing, testing, deploying, or QAing a counter C program plus a Next.js frontend, read [references/programs-and-abi.md](./references/programs-and-abi.md), [references/web-apps-and-wallets.md](./references/web-apps-and-wallets.md), and [references/live-validation-and-debugging.md](./references/live-validation-and-debugging.md), then use the program lifecycle, C counter quickstart, ABI validation, wallet integration, and web package docs in that order.
- If the task is setting up the toolchain, CLI, or local environment, use `https://thru.org/docs/program-development/setting-up-thru-devkit`.
- If the task is writing, validating, deploying, or upgrading a program or ABI, read [references/programs-and-abi.md](./references/programs-and-abi.md) and then use `https://thru.org/docs/program-development/program-development-lifecycle`.
- If the task is implementing the program itself, use `https://thru.org/docs/program-development/building-a-c-program`, `https://thru.org/docs/sdks/c`, and `https://thru.org/docs/abi/overview` together.
- If the task is ABI authoring, validation, reflection, or publish flows, read [references/programs-and-abi.md](./references/programs-and-abi.md).
- If the task is explorer reflection, published ABI decoding, or `root-types`, use `https://thru.org/docs/abi/explorer-compatibility`.
- If the task is building a Next.js, React, browser, backend, or mobile integration, read [references/web-apps-and-wallets.md](./references/web-apps-and-wallets.md), start with `https://thru.org/docs/sdks/web`, and choose exact package pages from `https://thru.org/docs/sdks/web-packages/thru-sdk`, `https://thru.org/docs/sdks/web-packages/wallet`, `https://thru.org/docs/sdks/web-packages/wallet`, and `https://thru.org/docs/sdks/web-packages/abi`.
- If the task is integrating the hosted wallet, wiring `connect()` or `signTransaction()`, or designing wallet approval UX, read [references/web-apps-and-wallets.md](./references/web-apps-and-wallets.md) and start at `https://thru.org/docs/wallet/overview`.
- If the task is implementing the embedded wallet flow in a web app, use `https://thru.org/docs/wallet/embedded-wallet-integration`.
- If the task is debugging wallet approval, signing, or explorer-submission behavior, use `https://thru.org/docs/wallet/troubleshooting`.
- If the task is choosing packages for backend, indexing, replay, ETL, read-model, or Postgres-backed work, read [references/indexers-and-read-models.md](./references/indexers-and-read-models.md) and use the exact package pages for `@thru/sdk`, `@thru/replay`, and `@thru/indexer`.
- If the task is adding indexing or deciding whether indexing is necessary, read [references/indexers-and-read-models.md](./references/indexers-and-read-models.md), start at `https://thru.org/docs/sdks/web` for package choice, and then use `https://thru.org/docs/indexing/overview` as supporting context.
- If the task depends on exact CLI syntax, use `https://thru.org/docs/cli-reference/overview` plus the relevant ABI, program, or transaction command page, and verify the local `thru` version and available subcommands.
- If the task is about deployment, live validation, or deployed-state debugging, read [references/live-validation-and-debugging.md](./references/live-validation-and-debugging.md) and use Explorer MCP docs first.

## Explorer MCP

Use Explorer MCP for live questions about:

- transactions
- accounts
- blocks
- account history
- on-chain ABI inspection

Public endpoint:

```text
https://scan.thru.org/api/mcp
```

Claude setup:

```bash
claude mcp add --transport http thru-explorer https://scan.thru.org/api/mcp
```

Codex setup:

```bash
codex mcp add thruExplorer --url https://scan.thru.org/api/mcp
codex mcp list
```

If setup details are needed, use:

- `https://thru.org/docs/api-ref/explorer-mcp/overview`
- `https://thru.org/docs/api-ref/explorer-mcp/tools-reference`

# Live Validation And Debugging

Use this reference when the task involves:

- deployment
- live-chain or devnet validation
- checking whether the environment is ready for writes
- deployed-state debugging
- Explorer MCP, RPC, or CLI inspection

## Current Docs To Open

Use the public docs for exact command syntax and current live-validation flow:

- setup and CLI config: `https://thru.org/docs/program-development/setting-up-thru-devkit`
- recommended lifecycle: `https://thru.org/docs/program-development/program-development-lifecycle`
- program commands: `https://thru.org/docs/cli-reference/program-commands`
- transaction commands: `https://thru.org/docs/cli-reference/transaction-commands`
- ABI publishing: `https://thru.org/docs/abi/deployment-and-program-testing`
- Explorer MCP overview: `https://thru.org/docs/api-ref/explorer-mcp/overview`
- Explorer MCP tools: `https://thru.org/docs/api-ref/explorer-mcp/tools-reference`

## Live Validation Prerequisites

After local compilation succeeds, always inspect:

- `.env.local` or equivalent local config
- exported `THRU_*` environment variables
- the active `thru` identity
- whether the selected account is actually funded or otherwise usable for writes

Then do one of two things:

- if the required config and credentials are present, continue into deployment or live-chain validation
- if they are missing, state exactly which input is missing

Do not assume live credentials or config are absent without checking.

## Funding And Fees

If the selected account is unfunded, it is not usable for live writes even if the key exists locally.

Before attempting deployment or live transactions:

- check whether the selected account can actually pay for writes on the target network
- if the target network offers a faucet, use that faucet to fund the account before retrying

Do not report a key as "usable for writes" until you have checked funding or otherwise confirmed it can submit transactions on the target network.

## Live Chain Tools

When the question depends on current chain state, inspect it live with:

- Explorer MCP
- RPC reads
- CLI reads

Do not guess from stale local context.

## Deployment Standard

Treat live devnet-style testing as the meaningful test for deployment behavior. Local reasoning alone is not enough for deployed program correctness.

For a C counter program, live QA should include deploying or identifying the deployed program, creating the counter account when needed, submitting at least one increment transaction, and reading the counter account or transaction result back through CLI, RPC, or Explorer MCP.

## Required Closeout

For substantial Thru tasks, end with a short validation summary covering:

- program compile status
- ABI validation status
- live-prerequisite check status
- live-chain test status

If live deployment/testing was not performed, say exactly why and name the concrete missing prerequisite or explicit stop condition that led you to stop.

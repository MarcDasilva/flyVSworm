# Web Apps And Wallets

Use this reference when the task involves:

- Next.js, React, mobile, or browser apps on Thru
- `@thru/sdk`, `@thru/wallet`, `@thru/wallet/react`, `@thru/wallet/react-ui`, `@thru/abi`, or embedded wallet integration
- `connect()` or `signTransaction()` flows
- frontend reads or user-submitted transactions
- a UI for a deployed C program, such as a counter frontend

## Defaults

For simple app tasks:

- prefer direct RPC reads or account streaming before adding indexing
- if the prompt says users send transactions, default to wallet-based user signing
- use server-side signing only if the user explicitly wants sponsorship, relaying, or backend-controlled writes, or if you clearly explain that architecture choice
- in Next.js, put wallet hooks and browser-only SDK calls behind client components
- create `.env.example` for deployment values instead of committing local secrets

## App + Program Order

For mixed app + program tasks:

1. finish the program + ABI validation loop first
2. then wire the app against the validated instruction/account shapes
3. then build the app
4. then check whether live deployment/testing is possible

Do not mock or guess instruction payload shapes if generated ABI helpers or `@thru/abi` can be used.

## Package Selection

Use the web SDK overview first, then exact package pages:

- `https://thru.org/docs/sdks/web` for web package orientation
- `https://thru.org/docs/sdks/web-packages/thru-sdk` for the default app-facing RPC, transactions, streams, and domain-model client
- `https://thru.org/docs/sdks/web-packages/wallet` for React provider and wallet hooks
- `https://thru.org/docs/sdks/web-packages/wallet` for non-React browser wallet integration
- `https://thru.org/docs/sdks/web-packages/abi` for ABI reflection and formatting of YAML plus binary payloads
- `https://thru.org/docs/sdks/web-packages/react-ui` only when ready-made wallet UI components are desired

For a simple counter page, start with `@thru/sdk` plus `@thru/wallet/react` when wallet signing is needed. Add indexing only if the product needs history, filtering, joins, or a Postgres-backed read model.

## Wallet URLs and deposits

- Use `https://app.tid.sh/embedded` for hosted browser embedding. `https://wallet.tid.sh` is a standalone link: it sends `X-Frame-Options: DENY`. SDK origin trust does not imply framing permission. Verified September 18, 2026; recheck headers and the installed SDK when diagnosing a failure.
- Install `@thru/wallet`; `@thru/wallet/react` is an import path within that package. Use `https://thru.org/docs/sdks/web-packages/wallet` for its reference.
- For deposits, set `network: ThruNetwork.Alphanet` and a matching `rpcUrl` on the provider. An RPC URL alone does not choose a deposit network. Do not silently switch networks to resolve deposit errors.
- The flow checked against published `@thru/wallet@0.3.16` is `deposits.prepare(DepositTarget.THRUSD)` → `ensureAccount({ destination })` → `open({ destination })` → `waitForDeposit({ destination, minimumBalanceRaw, signature })` or `getAccountState({ destination })`. Use the account returned by `prepare`, and prepare again after changing wallet or network. Account creation may require approval and native fees.
- Preserve the pre-deposit balance. Treat `cancelled`, `pending`, and `completed` distinctly. Confirm an on-chain balance increase before reporting credit; a timeout or closed UI is not proof of payment failure. Do not automatically repeat a payment. A balance increase alone does not identify one specific deposit.
- `Deposit network is not configured` comes from the hosted wallet when the request lacks a supported network. Distinguish this from a hosted deployment without the selected network's target/provider configuration. A dApp cannot fix hosted configuration by changing only its RPC.
- Native faucet funding provides THRU for fees. Add funds uses a provider to credit THRUSD and may involve a real payment. A separate restricted staging THRUSD faucet exists for allowed mints and existing token accounts; do not present it as a public faucet. No public self-service Alphanet THRUSD route was verified in this update.
- Public funding-guide route: `https://thru.org/docs/wallet/deposits-and-funding` (draft prepared September 18, 2026; do not assume it is deployed). Until it is published, use the practical flow above and verify installed package types. If docs are inaccessible, inspect the published package README, source, and declarations; repository source may differ from the npm release.
- Use the smallest supported wallet flow. Do not invent signing APIs or transaction payloads, expose provider/mint credentials, or move funds merely to validate documentation.

## Config Files

If real deployment values are not known yet:

- create `.env.example`
- document the required variables

Do not create a placeholder `.env.local` by default.

Typical public variables for a counter frontend include:

- `NEXT_PUBLIC_THRU_RPC_URL`
- `NEXT_PUBLIC_THRU_NETWORK`
- `NEXT_PUBLIC_THRU_PROGRAM_ID`
- `NEXT_PUBLIC_THRU_COUNTER_ACCOUNT`
- `NEXT_PUBLIC_THRU_WALLET_IFRAME_URL`

## Frontend QA

Before reporting a frontend as complete:

- run the package manager's lint, typecheck, and build commands when available
- start the local dev server and verify the main counter flow in a browser when practical
- if live chain config is missing, QA the disabled/loading/error states and state exactly which live values are missing

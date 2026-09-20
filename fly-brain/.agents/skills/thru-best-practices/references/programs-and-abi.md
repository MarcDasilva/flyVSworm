# Programs And ABI

Use this reference when the task involves:

- writing or changing a Thru program
- writing, testing, deploying, or QAing a counter C program
- defining instruction formats
- defining account layouts or event payloads
- creating or updating an ABI
- deploying or upgrading a program

## Current Docs To Open

Use the public docs for exact syntax:

- setup and toolchain: `https://thru.org/docs/program-development/setting-up-thru-devkit`
- recommended lifecycle: `https://thru.org/docs/program-development/program-development-lifecycle`
- counter C quickstart: `https://thru.org/docs/program-development/building-a-c-program`
- C SDK overview: `https://thru.org/docs/sdks/c`
- C common patterns: `https://thru.org/docs/sdks/c-reference/common-patterns`
- C common gotchas: `https://thru.org/docs/sdks/c-reference/common-gotchas`
- ABI overview: `https://thru.org/docs/abi/overview`
- ABI authoring: `https://thru.org/docs/abi/authoring-guide`
- ABI examples: `https://thru.org/docs/abi/examples`
- ABI validation and roundtrip: `https://thru.org/docs/abi/validation-and-roundtrip-testing`
- explorer-compatible publishing: `https://thru.org/docs/abi/explorer-compatibility`

## Execution Order

For program work, prefer this order:

1. Check that `thru` is installed along with the ABI subcommands and the C SDK/toolchain.
2. Write the program and ABI together.
3. Run `thru abi analyze` if available.
4. Run `thru abi codegen` if available.
5. Reflect sample instruction/account bytes if `thru abi reflect` is available.
6. Build the C program.
7. Only then move on to app integration or live validation.

Do not stop after `analyze` if `codegen` and `reflect` are available locally.

For a simple counter program, use the current C counter quickstart as the canonical implementation shape, then use the ABI examples and explorer compatibility docs to ensure the ABI has root instruction, account, event, and error types.

## ABI Is Mandatory

If you write or change:

- an instruction format
- an account layout
- an event payload
- a seed or account-derivation contract

then you must also create or update the ABI and validate it.

Use this loop:

```text
write ABI -> analyze -> codegen -> build payload -> reflect it back
```

Do not stop at "the YAML looks right."

## CLI Surface Verification

If the docs and the local `thru` behavior do not match:

- verify the local CLI version and available subcommands first
- use the best available local ABI validation path
- state clearly that the local `thru` surface differs from the docs flow

If `abi analyze`, `abi codegen`, and `abi reflect` exist locally, use them.

If the `thru` CLI is not installable in the environment, the published `@thru/sdk/abi` subpath provides ABI analysis and reflection as the best available local validation path. `codegen` has no npm equivalent; if you fall back to manual encoders, say so in the closeout.

## Generated Helpers

If `thru abi codegen` succeeds, prefer generated ABI helpers for instruction or account encoding when practical.

If you choose manual byte encoding instead, say why.

For a Next.js frontend, do not hand-write instruction bytes until generated TypeScript helpers or `@thru/sdk/abi` reflection have been considered against the validated ABI.

## Required Program Closeout

Before you say the program work is complete, state:

- whether the program build succeeded
- whether `abi analyze`, `abi codegen`, and `abi reflect` were run, unavailable, or skipped
- whether instruction/account bytes were built with generated helpers or manual encoding, and why if manual
- whether deployment and live transaction QA were performed, blocked by missing prerequisites, or intentionally left to the user

## Generated Outputs

Generated ABI bindings, reflected fixture outputs, and program build artifacts should usually be treated as generated files.

- do not hand-edit them unless there is a clear reason
- keep them from creating avoidable lint or typecheck noise

## Debugging Heuristic

If bytes reflect correctly but execution still fails, suspect:

- account ordering
- ownership or writability
- CPI auth model
- program logic
- runtime or VM faults

Do not keep rewriting the ABI if the payload already roundtrips correctly.

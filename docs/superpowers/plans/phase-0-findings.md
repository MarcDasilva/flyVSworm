# Phase 0 findings

The probe app is written and committed but has not been run on hardware yet. Phase 1 proceeds on the plan's designed assumptions until the probe is executed.

| Question | Answer | Consequence |
|---|---|---|
| `RADIO_BINARY_OK` | NOT YET MEASURED | If no, Task 22 hex-encodes every frame |
| `DEX_HEAP_COST` | NOT YET MEASURED | If over 16000, Task 3 regenerates packed art |
| `lua_peak` with dex resident | NOT YET MEASURED | Budget for everything else is `lua_limit` minus this |
| Accelerometer present | NOT YET MEASURED | If no, Task 15's bar fallback is the only catch path |

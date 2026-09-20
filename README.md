# KTNH Mon

Pokemon-inspired catch / duel / collect game for the
[Hack the North 2026 Hacker Badge](https://badge.hackthenorth.com/).

The badge is a 320x240 ESP32 running a Lua OS. Apps are Lua + LVGL widgets
pushed from the [Badge IDE](https://badge.hackthenorth.com/ide/).

## App

Push the files in `app/` from the Badge IDE. Share caps the directory at
48 KiB across 16 files, so `tools/bundle_check.sh` gates every change.

| File | Role |
|---|---|
| `app/manifest.cfg` | slug, heap budget, wake lock |
| `app/main.lua` | screen router, hub, walk mode, starter flow |
| `app/dex.lua` | species table and creature rendering |
| `app/own.lua` | collection, pokedex counts, crash-safe save |
| `app/dex.txt` | generated species data (`tools/gen_dex.py`) |

`heapcheck.lua` and `imgprobe.lua` are standalone probe apps for measuring
the widget and heap ceilings on real hardware.

## Tests

```sh
sh test/run.sh
```

Syntax-checks every Lua file, runs the host mocks in `test/`, and fails if
the bundle would exceed the Share cap.

## Sprites

- `sprites/gen1-16/` 151 uniform 16x16 PNGs, National Dex order
- `sprites/iconic-36/` curated picks grouped by type
- `sprites/app-icon-42.png` launcher icon

See `sprites/SOURCES.txt` for provenance and regeneration.

## Legacy C core

`legacy/c-core/` is the MCU-agnostic prototype of the 5-byte monster
payload, FSM, and throw detector. Superseded by `app/`, kept for reference.

```sh
gcc -std=c11 -Wall -Wextra -Werror -I legacy/c-core/include \
  legacy/c-core/src/monster.c legacy/c-core/src/badge_fsm.c \
  legacy/c-core/src/imu_throw.c legacy/c-core/test/host_check.c \
  -o host_check && ./host_check
```

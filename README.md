# KTNH Mon

Pokemon-inspired catch / battle / trade / heist game for the
[Hack the North 2026 Hacker Badge](https://badge.hackthenorth.com/).

This is the working repo. The old Solana quest (`htn-solana`) is leftover
event work and is not used here.

## Badge target

The badge is a 320x240 ESP32 with a **Lua OS** (not MicroPython, not a
C firmware you flash yourself). Custom apps are Lua + LVGL widgets:

- IDE: https://badge.hackthenorth.com/ide/
- Official API: [`docs/badge-ide-README.md`](docs/badge-ide-README.md)
- Lua+LVGL binding reference (cloned, gitignored): `vendor/luavgl`

HTN has not published the badge firmware source. The IDE README is the
public OS contract. `vendor/luavgl` is the closest public Lua+LVGL code
if you need to see how widgets bind.

## App

Push the files in `app/` from the Badge IDE:

| File | Role |
|---|---|
| `app/manifest.cfg` | slug `ktnh_mon`, 96 KiB heap, wake lock, HOME confirm |
| `app/main.lua` | UI, NFC, radio, IMU throw loop |
| `app/monster.lua` | 5-byte packed monster |
| `app/fsm.lua` | idle / encounter / battle / trade / heist |
| `app/throw.lua` | accelerometer throw grader |

Controls on device:

- Scan an NFC sticker to spawn a wild encounter
- Throw the badge to catch (Nice / Great / Excellent)
- **UP** sends a battle ping; bump/radio enters battle
- **Start** sends a trade ping
- **A** confirm, **B** cancel
- Shake during a heist to break the siphon
- Stickers whose NDEF text contains `rocket` arm a heist on the next bump

## Sprites

Classic Gen I–III dumps live in `sprites/` (~81 MB). PNGs are gitignored.
See `sprites/SOURCES.txt`. Closest to the badge 42x42 `icon.bin`:

`sprites/pokeapi/generation-i/red-blue/25.png`

In the IDE, **Choose image** crops to 42x42 LVGL RGB565A8.

## Legacy C core

`legacy/c-core/` is the first MCU-agnostic prototype of the same 5-byte
payload, FSM, and throw detector. The badge cannot run it. Host check:

```sh
gcc -std=c11 -Wall -Wextra -Werror -I legacy/c-core/include \
  legacy/c-core/src/monster.c legacy/c-core/src/badge_fsm.c \
  legacy/c-core/src/imu_throw.c legacy/c-core/test/host_check.c \
  -o host_check && ./host_check
```

## Refresh local clones

```sh
git clone --depth 1 https://github.com/XuNeo/luavgl.git vendor/luavgl
powershell -File sprites/fetch-numbered.ps1
```

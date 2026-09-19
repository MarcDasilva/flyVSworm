# KTNH Mon

Pokemon-inspired catch / battle / trade / heist game for Hack the North 2026.

Badge Lua lives in a teammate's work. This repo keeps sprites and the
legacy C payload/FSM prototype.

## Sprites

Classic Gen I–III dumps live in `sprites/` (~81 MB). PNGs are gitignored.
See `sprites/SOURCES.txt`.

```sh
powershell -File sprites/fetch-numbered.ps1
```

## Legacy C core

`legacy/c-core/` is the MCU-agnostic prototype of the 5-byte monster
payload, FSM, and throw detector.

```sh
gcc -std=c11 -Wall -Wextra -Werror -I legacy/c-core/include \
  legacy/c-core/src/monster.c legacy/c-core/src/badge_fsm.c \
  legacy/c-core/src/imu_throw.c legacy/c-core/test/host_check.c \
  -o host_check && ./host_check
```

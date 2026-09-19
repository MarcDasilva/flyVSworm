# KTNH Mon - design spec

Status: approved for implementation. Target: 2026 Hack the North Hacker Badge.

Sources: `docs/badge-ide-README.md` for the API contract, and
`badge.hackthenorth.com` plus the public Hacker Badge Instruction Manual for
the physical specification.

A creature collecting game in the shape of Pokemon GO, built for a 320x240
ESP32-C3 badge with a Lua OS. The real world supplies the map: NFC stickers are
nests and Pokestops, walking spawns encounters, and other attendees' badges
are live opponents.

## 1. Locked decisions

| Decision | Value |
|---|---|
| Species | 24, in 8 families of 3 stages |
| Art | 16x16 grid, 4 palette indices, drawn as box-widget row runs |
| Opening flow | Title -> egg -> shake to hatch -> pick 1 of 3 starters |
| Wild spawn sources | NFC nest stickers, and walking (step counter) |
| Pokestops | NFC tags tagged as stops; give balls and XP on a per-tag cooldown |
| Catch | Accelerometer throw, graded by speed; sweeping-bar fallback |
| Duels | Two badges over radio; each stakes one pokemon, winner takes it |
| Duel sync | Host-authoritative full snapshot, no acknowledgements |
| Build order | Shell, battle engine, radio PvP, catching, economy, extras |
| Wake lock | Off by manifest; taken at runtime in Walk mode and duels only |
| Tag roles | Derived from NFC UID hash, since the badge cannot write tags |

The starter is shielded and can never be wagered, stolen, or traded. That bit
already exists in `app/monster.lua`.

## 2. Hardware contract

Physical specification, from the badge site and the instruction manual:

| Part | Detail |
|---|---|
| SoC | **ESP32-C3** - single-core RISC-V, ~400 KB SRAM total, no PSRAM |
| Screen | 320x240 full colour |
| Buttons | **8**: directionals left, A and B right, HOME and START bottom |
| LEDs | 6 RGB |
| NFC | **Reader only**. The badge cannot write tags, from Lua or otherwise |
| Radio | Bluetooth. Lua gets a restricted broadcast channel, no Wi-Fi |
| Power | **Two AA alkaline cells.** "Battery life is limited and low batteries cause glitches" |

The ESP32-C3 is why the memory numbers are what they are. Roughly 400 KB of
SRAM is shared by the LVGL framebuffer, the BLE stack, littlefs and the Lua
heap, and there is no PSRAM to spill into. That is the origin of the guide's
`free=59588 largest=49152` reading, and it is why `heap_kb=96` is a quota
rather than a promise.

`badge.input.BUTTON` also defines `AUX1`, but the manual lists eight physical
buttons and `AUX1` is not among them. **Never bind a control to `AUX1`.**
This design uses A, B, UP, DOWN, LEFT, RIGHT, START and HOME - exactly the
eight that exist.

Every limit below comes from `docs/badge-ide-README.md`. They are the
budget, not guidance.

| Resource | Limit |
|---|---|
| Screen | 320x240, physical buttons only, no touch or click handlers |
| Widgets | 512 live |
| Lua heap | 48 KiB, or 96 KiB with `heap_kb=96`. An allocation ceiling, NOT reserved RAM |
| Share bundle | 48 KiB total, 16 files, paths under 64 bytes and 4 deep |
| `main.lua` | 64 KiB |
| Filesystem | 64 KiB quota, 16 KiB per read or write, no seek or partial read |
| `badge.store` | 32 keys, key names 24 bytes, string values 128 bytes, no newlines |
| Radio | 44-byte payload, broadcast only, 8-slot ring, 4 drained per tick |
| Modules | `require` depth 8, 16 modules |

Callback budgets: main chunk and `on_enter` 3,000 ms; `on_tick` and queued
`on_recv` share 250 ms; `on_button` 1,000 ms; `on_exit` 1,000 ms. Firmware
older than 2026-09-16 gives ticks 6 ms and buttons 20 ms instead, and there
is no way to detect which is installed. Design for the old numbers.

Absent and load-bearing: **no `pcall`**, no `setmetatable`, no `os`, `io`,
`coroutine`, no sleep, no audio, no wall clock. `badge.sys.ms()` is monotonic
since boot and resets on reboot.

Three consecutive `on_tick` failures suspend tick delivery; one `on_button`
failure suspends it immediately. Without `pcall` there is no recovery inside
the app, so every input from outside the app - radio payloads, NFC text,
saved files, sensor returns - MUST be validated before use.

### Power budget, and what it does to the walking loop

Two constraints combine into a design problem that is easy to miss:

1. **Apps run only in the foreground.** A tick handler or radio listener
   stops the moment the player returns HOME. There is no background
   execution of any kind.
2. **The badge runs on two AA alkalines,** and the official manual tells
   attendees to "turn it off when not using it" because "low batteries cause
   glitches."

So a Pokemon GO step counter that quietly accrues all weekend is impossible.
Steps only exist while this app is open, on screen, and holding a wake lock -
which is the most expensive way the badge can be run.

The design accommodates this rather than pretending otherwise:

- **`wake_lock` is 0 in the manifest** and taken at runtime with
  `badge.sys.wake_lock(true)` only in Walk mode and during an active duel.
  Every other screen lets the badge sleep normally.
- **Walk mode is an explicit screen,** not an ambient background state. It
  dims to a near-black UI, stops all per-tick repainting, drops the LEDs to a
  single dim pulse every two seconds, and does nothing but count steps.
- **The spawn threshold is tuned for a walk between rooms, not a marathon.**
  40 to 80 steps, roughly one minute, so a trip to get coffee is worth
  opening the app for.
- Steps also accrue free on any other screen while the app happens to be
  open. Walk mode is the deliberate version, not the only one.
- The MAP screen shows the tradeoff in plain words the first time Walk mode
  is opened.

A corollary for troubleshooting: an app that dies or behaves strangely
mid-session may be flat batteries, not a bug. Check cells before debugging
code.

## 3. Architecture

Ten files, plus an optional `icon.bin`, against the 16-file bundle cap.

| File | Responsibility | Depends on |
|---|---|---|
| `manifest.cfg` | slug `ktnh_mon`, `api=2`, `heap_kb=96`, `wake_lock=0`, `confirm_home=1` | - |
| `main.lua` | Lifecycle, screen router, input dispatch, LED driver | all |
| `fsm.lua` | Mode state machine and timeouts | `monster` |
| `dex.lua` | Species lookup, art decode, box-run renderer, type chart | - |
| `monster.lua` | 5-byte packed creature record | - |
| `battle.lua` | Turn resolution, damage, stats from base + IVs | `dex`, `monster` |
| `net.lua` | Radio framing, beacons, pairing, snapshots | `monster` |
| `catch.lua` | Throw grading, bar fallback, catch probability, step counter | - |
| `save.lua` | Load and persist to `appdata/save.dat` | `monster` |
| `dex.txt` | 24 species, move pool, type chart | - |

`app/throw.lua` is absorbed into `catch.lua`. `app/monster.lua` and
`app/fsm.lua` survive close to as written.

### Module boundaries

Each module is testable on a host Lua with no badge present.

- `dex` takes a species id, returns name, type, family, stage, base stats,
  move ids, catch rate, and an art iterator. It never touches widgets except
  through one `paint(pool, id, x, y, cell_px, palette)` entry point.
- `battle` is pure: state in, state out, no rendering and no radio. This is
  what makes two-badge agreement testable in one host process.
- `net` owns every byte that crosses the air. Nothing else calls
  `badge.radio`.
- `catch` is a streaming sensor consumer plus a probability function. The
  probability function is shared by the throw and the bar, so both mechanics
  balance identically.

## 4. Screens

Eleven screens, each a full-screen container box created once and shown or
hidden. Widgets are never recreated.

| Screen | Contents | Controls |
|---|---|---|
| TITLE | Logo, trainer name and role colour, loading state | A start |
| EGG | Egg drawn from the art pool, shake meter | Shake to hatch |
| STARTER | One starter at a time as a carousel | LEFT/RIGHT cycle, A pick |
| MAP | Level, XP, step meter, balls, dex count, nearby trainers, radio state | A scan, UP dex, DOWN party, LEFT duel, RIGHT radio toggle, START walk |
| WALK | Step count and meter only, near-black, low power | B back to MAP |
| ENCOUNTER | Wild creature art, name, level, type, ball count, throw prompt or bar | Throw, or A to stop the bar, B flee |
| DEX | 8 per page, owned marked | UP/DOWN page, A detail, B back |
| PARTY | Up to 6 held creatures | UP/DOWN select, A set active, START set wager, B back |
| PAIR | Nearby trainers by signal strength, wager confirm | UP/DOWN select, A challenge, B back |
| BATTLE | Opponent art and HP, your name and HP, up to four unlocked moves | LEFT/RIGHT pick, A use, B switch, HOME forfeit |
| STOP | Pokestop reward reveal | A collect |

WALK is three widgets and costs nothing. Only the opponent gets pixel art in
BATTLE. Your side is a name, a HP bar and
a type colour, so exactly one art canvas ever repaints.

### Widget budget and staged construction

One shared art pool of 48 boxes serves every screen, because no screen shows
two creatures at once - that is why STARTER is a carousel rather than three
side by side. Chrome is about 12 widgets per screen. Total is roughly
170 live widgets against a cap of 512.

Creating 170 widgets inside `on_enter` risks the 3,000 ms budget and fails
outright on old firmware. Instead: `on_enter` builds only TITLE, then each
`on_tick` constructs the next batch of about 12 widgets until every screen
exists. The title screen IS the loading screen, and A is ignored until
construction finishes. This is the pattern the guide prescribes for large
boards.

## 5. Data format: `dex.txt`

One file, read once with `badge.fs.read`, held as a single string. Line
offsets are kept as integers and substrings are taken on demand. Splitting it
into 24 strings would roughly double its heap cost.

Species line, space separated, about 290 bytes each:

```
id name type family stage base_hp base_atk base_def base_spd catch_rate move_ids art
02 EMBERKIT 1 2 1 45 49 43 45 190 01,03,07,09 0011100022...
```

`art` is 256 characters: 16 rows of 16, row major, palette index per cell.

- `0` empty
- `1` body
- `2` shade
- `3` accent, used for eyes and markings

Palette colours are not stored. They are derived from the creature's type at
paint time, so one grid renders in sixteen palettes.

Two further sections in the same file:

- A move pool of 24 entries: `id name type power accuracy`.
- The type chart as a single 256-character string, one character per
  (attacker, defender) pair at index `attacker * 16 + defender + 1`:
  `0` immune, `1` half damage, `2` normal, `3` double.

Total: 24 species at about 290 bytes, a 600-byte move pool and a 256-byte
type chart, so roughly 7.8 KB. Under the 16 KiB per-file read cap with room,
and about 16 percent of the Share bundle.

Held in reserve, not done up front: packing two cells per hex character
halves the art and brings the file to about 4.7 KB. Apply only if `badge.sys.stats()` or the bundle
size demands it, because packed art cannot be read or hand-edited while
creatures are still being tuned.

### Art rendering

A naive renderer would need one box per cell: 256 widgets for one creature,
half the entire cap. Instead each row is drawn as runs of a single colour.
Measured across generated species, a 16x16 creature averages 33 runs and
peaks around 40 - fewer boxes than a per-cell 8x8 renderer would need, at
four times the detail.

Painting is `set_pos`, `set_size`, `set_color` per run, roughly 120 native
calls. Unused boxes in the pool are hidden rather than deleted. On old
firmware, paint eight runs per tick and let the fill-in read as the encounter
reveal animation.

Cell size is an integer pixel count, so one grid serves every screen:
9 px gives 144x144 for an encounter, 6 px gives 96x96 for a battle opponent,
3 px gives a 48x48 dex thumbnail.

### Generated creatures

24 creatures, 8 families, generated by a parametric Python script kept in
`tools/gen_dex.py` and committed alongside its output. Each family gets a
distinct body plan - horns, long ears, side fins, quadruped, winged,
serpentine, round, tall - because eight variations on one silhouette defeats
the point of collecting. Stages grow in size and gain markings.

No sourced sprite art. `badge.ui.image` requires an installed `.bin` and the
IDE's only image path produces a single 42x42 `icon.bin` for the launcher, so
downloaded art cannot reach the screen at all. Official Pokemon art is also
Nintendo's, and Share broadcasts the whole app directory to other badges,
which is distribution.

## 6. Creature record

`app/monster.lua`, unchanged, 5 bytes:

| Byte | Contents |
|---|---|
| 0 | species, 0 means empty |
| 1 | shiny bit, level 1-127 |
| 2 | hp IV (3 bits), shield bit, type (4 bits) |
| 3 | atk IV (4 bits), def IV (4 bits) |
| 4 | move unlock bitmask |

A full team of three is 15 bytes, which fits one radio frame with room for
headers. That is why this format survives.

The move bitmask indexes the species' own four moves from `dex.txt`, not a
global pool, so the pool can grow to 24 moves without changing the wire
format. Bits set by level: one move at level 1, a second at 8, a third at 16,
a fourth at 24.

Derived stats, integer only:

```
hp  = floor((2 * base_hp  + hp_iv  * 4) * level / 100) + level + 10
stat = floor((2 * base_stat + iv * 4) * level / 100) + 5
```

## 7. Duel protocol

The channel is broadcast, unaddressed, lossy, 44 bytes, and shared with every
other badge in the room running anything.

### Sync model

**Host-authoritative full snapshot.** The host computes the entire turn and
broadcasts the complete battle state. The joiner broadcasts only its chosen
move. Every frame is idempotent and latest-wins, so a dropped frame is
repaired by the next one with no acknowledgement, no sequence number, no
retransmit timer, and no shared random seed.

The alternative - lockstep determinism with a shared PRNG - needs
bit-identical code on both badges, per-turn retransmission, and fails
silently when it fails. At 44 bytes per frame there is no reason to buy that.

Cost accepted: the joiner renders one frame behind, and a host that walks out
of range stalls the duel into a timeout forfeit.

### Frames

Every frame starts with `KM1` and a one-byte kind. Payloads are binary.

| Kind | Sender | Payload | Bytes | Cadence |
|---|---|---|---|---|
| `B` beacon | any | short id (2), name (up to 8), lead species (1), lead level (1) | 16 | every 2,000 ms, MAP only |
| `C` challenge | host | sid (2), staked creature (5) | 11 | every 500 ms until accepted |
| `A` accept | joiner | sid (2), staked creature (5) | 11 | every 500 ms until a snapshot arrives |
| `S` snapshot | host | sid (2), state (11) | 17 | on every turn, plus every 500 ms |
| `M` move | joiner | sid (2), turn (1), move (1) | 8 | every 400 ms until the snapshot's turn advances |
| `E` end | host | sid (2), result (1), transferred creature (5) | 12 | 5 times over 2 s |

Snapshot state, 11 bytes: turn, phase, packed active indices, six HP values,
packed last actions, effect flags.

The session id is a 16-bit random value chosen by the host. Every frame after
the beacon is filtered on it, so two duels in the same room never collide.

**Pairing cannot use bump.** The badge's built-in Connect app pairs by
physically bumping two badges together, and that is the natural gesture for
starting a duel, but bump and sync are system frames: Lua "can neither emit
nor observe" them. Pairing is therefore beacon plus on-screen selection from
the PAIR list, ordered by signal strength so the nearest trainer sorts
first.

A friendly duel sends an all-zero creature as its stake. The protocol is
identical, which is why staked duels need no protocol work when they land in
phase 4.

### Validating hostile input

There is no `pcall`. A malformed frame from a stranger's badge is a fatal
error that suspends ticks, not an exception. Therefore, in `net.lua`:

1. Reject anything shorter than 4 bytes or not prefixed `KM1`.
2. Reject any kind byte outside the known set.
3. Reject any frame whose length does not exactly match its kind.
4. Read every field through one clamped accessor that returns 0 out of range.
5. Range-check every decoded value - species against 24, level against 127,
   move index against 4, HP against the computed maximum - before it reaches
   `battle` or the renderer.

Nothing outside `net.lua` ever sees a raw payload.

### Binary payload risk

The guide states `badge.fs` is binary safe. It says nothing about
`badge.radio`, and `monster.lua` packs NUL bytes. If binary payloads do not
survive, every frame hex-encodes instead: the largest frame grows from 17 to
31 bytes, still inside 44, and no other part of the design changes. Phase 0
settles this in twenty minutes.

### Rate limiting

Beacons only while the radio is explicitly on and the MAP screen is showing.
The ring drains 4 frames per tick at a nominal 20 ms cadence, about 200
frames per second, against roughly 25 per second from fifty beaconing badges.
`badge.radio.dropped()` is shown on the MAP screen as a diagnostic.

`badge.radio.disable()` takes about two seconds and needs its own RAM, so the
radio is an explicit toggle, never always on.

## 8. Catching

### Throw

`catch.lua` streams `badge.sensor.accel()` milligravity samples, calibrates
gravity over the first 25 samples, then detects a throw as a rise past
1,800 mg followed by four samples under 600 mg. It grades on peak forward
acceleration and straightness - lateral energy against forward energy:

| Grade | Peak Y | Straightness | Multiplier |
|---|---|---|---|
| Excellent | 3,500 mg | 200 | 2.0x |
| Great | 2,500 mg | 140 | 1.5x |
| Nice | 1,800 mg | - | 1.0x |

These thresholds are calibration knobs, not constants. Real accelerometers
read off, and the correct values are whatever a hard throw actually produces
on the badge in hand. Expose them at the top of `catch.lua` and tune on
hardware.

### Probability

One function, shared by both input mechanics, integer arithmetic throughout
and clamped to 5-95 percent so no encounter is hopeless or certain:

```
chance = catch_rate * grade_mult * level_factor * dex_bonus / 100000
```

- `catch_rate` per species from `dex.txt`, 0-255. High for stage 1, low for
  stage 3
- `grade_mult` 10, 15 or 20, from the throw grade
- `level_factor` = `max(40, 100 - 4 * (wild_level - trainer_level))`, so a
  creature ten levels above you is caught at 60 percent of the normal rate
  and the penalty floors at 40
- `dex_bonus` = `100 + 10 * min(5, copies_owned)`, capped at 150

The divisor folds the 255 catch-rate scale, the tenths in `grade_mult`, and
the two percentage terms. Every term is a tuning knob; the numbers above are
starting points to calibrate on hardware, not balance.

Three balls per encounter. Each miss rolls a flee chance that rises with
rarity. The encounter also ends after 30 seconds.

### Bar fallback

`badge.sensor.accel()` returns nil plus an error when the accelerometer is
unavailable. After three consecutive nil reads the encounter switches to a
bar that sweeps left and right; A stops it. The green window's width in
pixels is the same computed percentage, so the two mechanics balance from one
formula and there is nothing separate to tune. The sweep is mirrored on the
LED ring as a travelling light.

### Step counter

There is no step API. `catch.lua` derives steps from accelerometer magnitude:
deviation from calibrated gravity, peak detection with hysteresis, and a
250 ms refractory period. A wild encounter spawns every `40 + random(40)`
steps - about a minute of walking, deliberately short, for the battery
reasons in section 2. The six LEDs fill clockwise as the meter charges.

Step counting runs on MAP and in Walk mode only. It is suppressed everywhere
else so that throwing the badge does not also register as walking.

Walk mode is the low-power variant of MAP: near-black UI, no per-tick
repaint, one dim LED pulse every two seconds, `badge.sys.wake_lock(true)`
held, and nothing on screen but the step count and the meter. It exits to
ENCOUNTER when the meter fills.

## 9. NFC

NFC is power hungry and off by default. Enable in `on_enter`, handle failure
by disabling the nest and stop features and saying so on the MAP screen.
NDEF text reads involve hardware work and are never done per tick - the app
reads text only when `badge.nfc.card()` reports a UID it has not just seen.

### Roles come from the UID, not from authored tags

The original plan read the NDEF text for keywords like `stop`. That does not
survive contact with the venue. **The badge is a reader only and cannot write
tags**, so a player has no way to author their own - they would need a phone
and blank NTAG stickers. Meanwhile the venue is already covered in
flower-pattern stickers for the official Scanner app, whose NDEF payloads are
Hack the North's and say nothing about this game.

So the role is **derived from a hash of the tag UID** instead:

| `hash(uid) % 8` | Role |
|---|---|
| 0 | Pokestop: grants balls and XP |
| 1-7 | Nest: family is `hash >> 3 % 8`, spawning that family's creatures |

Every sticker in the building becomes playable content with nothing to set
up, one stop for roughly every eight tags, and the same sticker is the same
place for every player - which is what makes a nest worth telling a friend
about.

NDEF text is still read and still honoured as an **override** when it
contains `stop` or `rocket`, so a player who does own an NFC writer can
author a Pokestop or arm a heist deliberately. It is a bonus path, never the
mechanism.

A nest's family is fixed by its UID; stage and level vary per visit.

### Cooldowns without a clock

`badge.sys.ms()` is monotonic since boot and resets on reboot, so a
time-based cooldown does not survive power cycling. Cooldowns are measured in
**steps instead**: a tag is spent until the trainer has walked 100 more
steps. Steps are already persisted, so this survives reboot for free and ties
the economy to the walking loop.

The tag log lives in `appdata/save.dat`: up to 24 entries of UID prefix plus
the step count at last visit, evicted least-recently-used.

## 10. Persistence

One binary file, `appdata/save.dat`, written through `badge.fs` which is
explicitly binary safe:

| Offset | Size | Contents |
|---|---|---|
| 0 | 1 | Format version, currently 1 |
| 1 | 4 | XP, little endian |
| 5 | 4 | Lifetime steps |
| 9 | 1 | Balls held |
| 10 | 1 | Party count |
| 11 | 30 | Party: 6 slots of 5 bytes |
| 41 | 48 | Dex: 24 entries of (count, best level) |
| 89 | 336 | Tag log: up to 24 entries of 14 bytes |

About 425 bytes.

`badge.store` holds only `sv`, the format version, as a cheap corruption
guard readable before the file load.

Write on: starter chosen, creature caught, duel ended, Pokestop collected,
and `on_exit`. Never on a tick - the guide is explicit that flash writes at
frame rate also cost callback time.

Because there is no `pcall`, a truncated or absent file must not crash. Every
field read is length-checked first, and anything shorter than 41 bytes is
treated as a fresh save. Tell the user to leave through HOME rather than
powering off, since `on_exit` is not guaranteed to run.

### Why not `badge.store` for the whole save

It would fit: 24 species at three characters each is 72 characters, inside
the 128-byte string cap. The cap is the reason not to - it puts a hard
ceiling of 42 species on the game and leaves no room for the tag log. The
file has none of those limits and is binary safe.

## 11. LED language

Six LEDs, Lua indices 1-based. Physical layout viewed from the front with the
screen upright: 1 upper left, 2 upper right, 3 middle right, 4 bottom right,
5 bottom left, 6 middle left. Clockwise from upper left is `{1,2,3,4,5,6}`.

| State | LEDs |
|---|---|
| Title | Slow breathe in `badge.me.color()` |
| Egg | Warm white, pulse rate rising with shake progress |
| Hatch | White flash, then the starter's type colour chasing clockwise |
| Map idle | Lead creature's type colour, slow breathe |
| Step meter | Clockwise fill, one LED per sixth of the spawn meter |
| Encounter | Species type colour, pulsing |
| Throw armed | All dim white |
| Nice / Great / Excellent | 1, 2 or 3 green flashes |
| Caught | Green clockwise chase |
| Fled | Two red pulses |
| Pokestop | Cyan spin, then one green LED per item granted |
| Radio scanning | Cyan sweep, white blip per beacon received |
| Duel | Left `{1,6,5}` your HP, right `{2,3,4}` theirs, in type colour |
| Super effective | White flash on the struck side |
| Win / loss | Winner's colour wave, or a red fade |

Stage a whole frame then call `badge.led.show()` once. Update at most every
80 ms, and derive each frame from `badge.sys.ms()` rather than a counter,
because ticks pause and the clock does not.

## 12. The `confirm_home` trap

`confirm_home=1` is set so a fumbled HOME cannot lose a duel. It pauses tick
delivery while the confirmation is open, `badge.sys.ms()` keeps advancing,
and Lua gets no cancel callback.

Rule: every tick computes `gap = now - last_tick`. When `gap > 300`, treat it
as a resume - reset the throw detector to recalibrate, restart the catch bar
sweep from its current position, credit no steps for the gap, and do not
advance any duel timeout. Without this the catch bar sweeps invisibly during
the confirmation and the player loses a ball to a dialog.

## 13. Build phases

Each phase ends in a complete app that can be pushed and played. Each gate is
a thing to verify on hardware, not a feeling.

| Phase | Scope | Gate |
|---|---|---|
| 0 | Host mock harness; throwaway probe app | Binary radio payloads survive or they do not; accelerometer present; `badge.sys.stats()` after loading `dex.txt` |
| 1 | `dex.txt` and generator, art renderer, title, egg, hatch, starter pick, MAP, save | Staged widget construction finishes inside budget; `lua_peak` measured and recorded; save survives a reboot |
| 2 | Battle engine, party, move unlocks, practice AI | 50 consecutive battles with no heap growth; win, loss and forfeit all return cleanly to MAP |
| 3 | Radio: beacons, pairing, snapshot duels, friendly stakes only | Two badges; walk out of range mid-duel and confirm both recover; `dropped()` stays near zero |
| 4 | Catching: steps, NFC nests, throw, bar fallback, dex browser, staked duels | Catch rates feel right on hardware after tuning; a wagered creature transfers exactly once |
| 5 | Pokestops, ball economy, XP and trainer levels, evolution | Step-based cooldowns survive a reboot |
| 6 | Trading, Team Rocket heist, shinies, polish | Bundle still under 48 KiB |

Phase 0 exists because two unknowns cannot be settled on paper: whether the
radio carries binary, and what the real heap looks like with `dex.txt`
resident. Both change the design if they go the wrong way, and both are
cheaper to learn now than in phase 3.

Phase 3 ships friendly duels only because staking requires catchable
creatures, which arrive in phase 4. The `C` and `A` frames carry a stake
field from the start, so this costs no rework.

## 14. Testing

No `pcall` on the badge means the host harness is the only place logic can
fail safely. Keep it.

**`test/mock_badge.lua`** builds a fake `badge` table and a `require` shim,
then drives the real `on_enter`, `on_tick`, `on_button` and `on_exit`. It
cannot see RAM or timing, but it catches state-machine, arithmetic and
protocol bugs in a second on a laptop. `luac -p` on every file is the syntax
gate.

**`test/test_duel.lua`** is the highest-value test in the project. It
instantiates two complete app states in one Lua process, wires their radios
together through a queue that drops 20 percent of frames and reorders some,
runs 100 duels to completion, and asserts that both sides agree on the
winner, that exactly one creature transfers, and that neither side errors.
Loss recovery is the whole point of the snapshot model, so it is the thing
worth proving.

Additional asserted checks:

- Every coordinate and dimension handed to a widget is an integer.
- A truncated, empty and garbage `save.dat` all load as a fresh save.
- Every malformed radio payload class from section 7 is rejected without
  reaching `battle`.
- `badge.sensor.accel()` returning nil falls through to the bar.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Physical RAM, not the quota, is the real ceiling. The guide records an app dying while compiling at 14 KB of source with `free=59588 largest=49152` before launch | Measure `badge.sys.stats()` at every phase gate. Art packing halves `dex.txt`. Raising `heap_kb` cannot fix it |
| Radio may not carry binary payloads | Phase 0 probe; hex encoding designed in and still inside 44 bytes |
| A malformed frame is fatal with no `pcall` | Validate-first rule and clamped accessors, all inside `net.lua` |
| Old firmware gives 6 ms ticks | Batch every construction and paint loop; derive animation from `badge.sys.ms()` |
| 48 KiB Share bundle, of which `icon.bin` is 5,304 bytes | Track bundle size at every gate; art packing in reserve; drop `icon.bin` for a text icon if needed |
| 24 generated creatures looking alike | Eight distinct family body plans, stages that add markings, not just scale |
| Wagering is grief-able over an anonymous channel | Starters are shielded and cannot be staked; a wager is set only from the PARTY screen and confirmed again before the duel starts |
| Trainer walks away mid-duel | 15 seconds without a peer frame shows connection lost and offers forfeit; the stake does not transfer |
| Two AA alkalines, and the manual warns that low batteries cause glitches | `wake_lock` off by default and taken only in Walk mode and duels; Walk mode stops repainting and dims the LEDs; save on every meaningful event so a brownout costs at most one action |
| Steps cannot accrue in the background, so the GO-style walking loop is weakened | Spawn threshold cut to 40-80 steps; steps accrue on MAP too, not only in Walk mode; NFC stickers remain the primary spawn source |
| `badge.input.BUTTON.AUX1` exists in the enum but not on the board | Controls use only the eight physical buttons; asserted in the mock harness |

## 16. Explicitly out of scope

Audio, because there is no Lua audio API at all - the LEDs carry all
feedback. A scrolling tilemap overworld, because the renderer would spend the
memory budget the creatures need. Individual creature instances with
nicknames and per-catch IVs, since the dex records a species at its best
caught level. 151 species. 18 types with full coverage, though the chart is
stored as all 16. Items beyond balls. Any network, Wi-Fi or HTTP feature, as
none exists.

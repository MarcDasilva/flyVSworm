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
| Species | **36**, in 12 families of 3 stages, 2 families per type, 6 per type |
| Art | 16x16 grid, 4 palette indices, drawn as box-widget row runs |
| Opening flow | Title -> egg -> shake to hatch -> pick 1 of 3 starters |
| Wild spawn sources | NFC nest stickers, and walking (step counter) |
| Pokestops | NFC tags tagged as stops; give balls and XP on a per-tag cooldown |
| Catch | Countdown, 5-second shake window, then an accelerometer throw graded by speed; sweeping-bar fallback |
| Types | **Six**, on a symmetric wheel: Water, Normal, Fire, Ice, Grass, Electric |
| Duel teams | **Any three distinct types.** Gates dueling behind collecting, without forcing specific types |
| Duels | One round of rock paper scissors, sudden death, over radio |
| Duel reward | Winner picks one of the loser's three and gets ONE capture attempt |
| Duel sync | Commit-reveal, then host-authoritative result |
| Build order | Shell, **catching**, economy, radio PvP, extras |
| Wake lock | Off by manifest; taken at runtime in Walk mode and duels only |
| Tag roles | Derived from NFC UID hash, since the badge cannot write tags |

The starter is shielded: it can never be targeted in a capture phase, stolen
or traded. That bit already exists in `app/monster.lua`.

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
| `dex.lua` | Species lookup, art decode, box-run renderer | - |
| `monster.lua` | 5-byte packed creature record | - |
| `battle.lua` | Team legality, commit-reveal, six-type wheel resolution | `dex`, `monster` |
| `net.lua` | Radio framing, beacons, pairing, snapshots | `monster` |
| `catch.lua` | Throw grading, bar fallback, catch probability, step counter | - |
| `save.lua` | Load and persist to `appdata/save.dat` | `monster` |
| `dex.txt` | 36 species | - |

`app/throw.lua` is absorbed into `catch.lua`. `app/monster.lua` and
`app/fsm.lua` survive close to as written.

### Module boundaries

Each module is testable on a host Lua with no badge present.

- `dex` takes a species id, returns name, type, family, stage, base stats,
  move ids, catch rate, and an art iterator. It never touches widgets except
  through one `paint(pool, id, x, y, cell_px, palette)` entry point.
- `battle` is pure: state in, state out, no rendering and no radio. It is
  now about forty lines - three type comparisons, a level tiebreak and a
  commitment check - which is what makes two-badge agreement trivially
  testable in one host process.
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
| PARTY | Up to 6 held, with the duel-legal Water/Fire/Grass trio marked | UP/DOWN select, A set duel slot, B back |
| PAIR | Nearby trainers by signal strength; blocked with the missing type named if the party is not duel-legal | UP/DOWN select, A challenge, B back |
| BATTLE | Four phases in one screen: pick (your three, peer hidden), reveal, result, capture | LEFT/RIGHT pick, A confirm, HOME forfeit |
| STOP | Pokestop reward reveal | A collect |

WALK is three widgets and costs nothing. BATTLE shows one creature at a
time - yours during the pick, the opponent's from the reveal onward - so it
shares the single art pool like every other screen.

The capture phase reuses ENCOUNTER's countdown, shake meter and throw
widgets verbatim rather than building a second set. One catch UI, one set of
bugs.

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
into 36 strings would roughly double its heap cost.

**36 species, 12 families of 3 stages, 2 families per type.** 36 divides
evenly by six types and three stages, giving six species of each type. Every
species sits on the wheel; there is no off-wheel type, because a creature
that could never be fielded is dead content.

Species line, space separated, about 285 bytes each:

```
id name type family stage strength catch_bias art
04 EMBERKIT 1 2 1 3 190 0011100022...
```

- `type` is the creature's **position on the wheel**: 1 Water, 2 Normal,
  3 Fire, 4 Ice, 5 Grass, 6 Electric. The ordering is load-bearing - the
  battle resolver is modular arithmetic on this number
- `strength` is 1-10 and sets capture difficulty
- `catch_bias` is a per-species nudge on top of strength, for making a
  particular creature a deliberate prize
- `art` is 256 characters: 16 rows of 16, row major, palette index per cell

Palette indices:

- `0` empty
- `1` body
- `2` shade
- `3` accent, used for eyes and markings

Palette colours are not stored. They are derived from the creature's type at
paint time, so one grid renders in six palettes.

**No move pool and no type chart.** The wheel is one modular subtraction; a
36-entry effectiveness table would be dead weight and could drift out of
sync with itself.

Total: 36 species at about 285 bytes, so roughly 10.3 KB. That clears the
16 KiB per-file read cap with 5.7 KB spare, and takes about 21 percent of
the Share bundle.

The bundle is the limit to watch, and it moved in our favour: `icon.bin` is
5,304 bytes and `dex.txt` is 10.3 KB, leaving roughly 33 KB for Lua source.
Deleting the damage engine, the move pool and the type chart cut the code
budget by more than the extra twelve species added, so 36 is less tight now
than 24 was under the old combat design.

Held in reserve, not done up front: packing two cells per hex character
halves the art and brings the file to about 5.7 KB. Apply only if
`badge.sys.stats()` or the bundle size demands it, because packed art cannot
be read or hand-edited while creatures are still being tuned.
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

36 creatures, 12 families, generated by a parametric Python script kept in
`tools/gen_dex.py` and committed alongside its output.

Twelve distinct body plans is the real cost of 36, and it is art work rather
than budget. Six types helps here: the palette sorts creatures into six
groups, so only **two** families share each colour and have to be told apart
by silhouette. The generator therefore varies four independent axes
rather than picking from a fixed list of shapes: **body** round, tall, squat
or serpentine; **head** merged, distinct or crested; **limbs** none, two,
four or finned; **crown** none, horns, long ears or antennae. That is 192
combinations, so twelve genuinely distinct plans is comfortable.

Stages grow in size and gain markings rather than changing plan, so a family
still reads as a family. Stages grow in size and gain markings.

No sourced sprite art. `badge.ui.image` requires an installed `.bin` and the
IDE's only image path produces a single 42x42 `icon.bin` for the launcher, so
downloaded art cannot reach the screen at all. Official Pokemon art is also
Nintendo's, and Share broadcasts the whole app directory to other badges,
which is distribution.

## 6. Creature record

`app/monster.lua`, 5 bytes, unchanged on the wire:

| Byte | Contents |
|---|---|
| 0 | species, 0 means empty |
| 1 | shiny bit, level 1-127 |
| 2 | hp IV (3 bits), shield bit, type (4 bits) |
| 3 | atk IV (4 bits), def IV (4 bits) |
| 4 | reserved, was the move bitmask |

A full team of three is 15 bytes, which fits one radio frame with room for
headers. That is why this format survives a complete redesign of the battle.

Rock paper scissors needs only two numbers, and neither costs a wire byte:

- **Type** is already in byte 2. Only Water, Fire and Grass are used.
- **Level** is already in byte 1. It breaks mirror matches and rises with
  catches and duel wins.
- **Strength, 1 to 10,** is a species attribute looked up from `dex.txt`, not
  stored per creature. It sets capture difficulty and nothing else. Stage 1
  species sit at 1-4, stage 2 at 4-7, stage 3 at 7-10, so evolving a creature
  makes it harder for somebody else to take from you.

The IV bits and the old move bitmask are now unused. They stay in the layout
rather than being reclaimed, because changing the record would break save
compatibility and the wire format for two bytes nobody needs.
## 7. Duels

### Format

A duel is one round of rock paper scissors, sudden death.

**Both players field three creatures of three distinct types.** The app
refuses to open the PAIR screen until the party holds three different types
and says how many the player is short. This is the progression gate - you
start with one starter and must catch at least two other types before you
can duel anybody. Any three of the six qualify, so it gates on collecting
breadth rather than on specific luck.

### The type wheel

Six types on a circle. **Each type beats the next two, ties the one
opposite, and loses to the previous two.**

```
Water -> Normal -> Fire -> Ice -> Grass -> Electric -> back to Water
```

| Type | Beats | Ties | Loses to |
|---|---|---|---|
| Water | Normal, Fire | Ice | Grass, Electric |
| Normal | Fire, Ice | Grass | Electric, Water |
| Fire | Ice, Grass | Electric | Water, Normal |
| Ice | Grass, Electric | Water | Normal, Fire |
| Grass | Electric, Water | Normal | Fire, Ice |
| Electric | Water, Normal | Fire | Ice, Grass |

**Store the wheel order, not the table.** Type ids ARE positions on the
circle - Water 1 through Electric 6 - so the whole chart is arithmetic:

```lua
local d = (theirs - mine) % 6
-- d == 1 or d == 2  -> I win
-- d == 0 or d == 3  -> tie, fall through to level
-- d == 4 or d == 5  -> I lose
```

A 36-entry lookup table would be dead weight, and a table can drift out of
sync with itself. This cannot.

Properties, asserted in `test_duel.lua` rather than trusted:

- Every type has exactly two wins, two losses and one cross-type tie. No
  dominant pick and no trap type.
- The relation is antisymmetric: A beats B if and only if B loses to A.
- 24 of 36 pick pairings are decisive, so two duels in three are settled by
  the read rather than the tiebreak.
- All six relations a Pokemon player expects hold - Water over Fire, Fire
  over Grass, Fire over Ice, Grass over Water, Electric over Water, Ice over
  Grass. Nothing contradicts canon.

### Resolution

- The wheel decides, per the arithmetic above.
- Tie, whether a mirror or the opposite-type tie: **the higher level wins.**
  That is one matchup in six, so it stays a tiebreak rather than the main
  event.
- Tie with equal levels: the host's RNG decides, and the frame says so.

The winner gets one capture attempt, described in section 8. The loser gets
nothing.

### Capture phase

1. The winner sees the loser's three creatures with name, type, level and
   strength, and picks one with LEFT/RIGHT and A.
2. Shielded starters are not selectable. A player only ever has one starter,
   so there are always at least two valid targets.
3. Three second countdown, five second shake window, then the throw.
4. The host resolves and broadcasts the result. On success the creature
   moves: added to the winner's party, removed from the loser's.

A creature transfers ONLY on a successful ball. Losing a duel costs nothing
by itself, which is what keeps a broadcast channel with anonymous strangers
tolerable.

### Sync model

**Host-authoritative.** The host computes the reveal and the capture result
and broadcasts complete state. The joiner broadcasts only its commitment,
its reveal, and its target choice. Every frame is idempotent and latest-wins,
so a dropped frame is repaired by the next one with no acknowledgement, no
sequence number and no retransmit timer.

### Commit and reveal

Sudden death makes this load-bearing. **Every badge in the room hears every
frame.** If the joiner broadcast its pick in the clear, the host's app would
hold that value before the host had chosen, and a duel would be decided by
whoever picked second.

So each side first broadcasts a commitment, and reveals only after it has
seen the peer's commitment:

```
commit = fnv16(pick .. nonce)     -- nonce is a 16-bit random value
reveal = pick, nonce              -- peer recomputes and compares
```

A mismatched reveal forfeits the round. FNV-1a over 16 bits is not
cryptography - a purpose-built cheating app could brute-force three picks
across 65,536 nonces. That is the known ceiling, and it is the right one: it
costs about a dozen lines, and it defeats every accidental and casual case.
Upgrade path if it ever matters is a wider hash, not a different protocol.

### Frames

Every frame starts with `KM1` and a one-byte kind. Payloads are binary.

| Kind | Sender | Payload | Bytes | Cadence |
|---|---|---|---|---|
| `B` beacon | any | short id (2), name (up to 8), team types (1), best level (1) | 16 | every 2,000 ms, MAP only |
| `C` challenge | host | sid (2), team (15) | 21 | every 500 ms until accepted |
| `A` accept | joiner | sid (2), team (15) | 21 | every 500 ms until a commit arrives |
| `H` commit | both | sid (2), commitment (2) | 8 | every 400 ms until the peer's commit is seen |
| `R` reveal | both | sid (2), pick (1), nonce (2) | 9 | every 400 ms until the result arrives |
| `S` result | host | sid (2), winner (1), picks (1), reason (1) | 9 | every 500 ms until a target arrives |
| `T` target | winner | sid (2), slot (1) | 6 | every 400 ms until the outcome arrives |
| `E` outcome | host | sid (2), caught (1), creature (5) | 11 | 5 times over 2 s |

Largest frame is 21 bytes against a 44-byte limit, so hex-encoding as a
fallback for binary payloads stays comfortably inside budget.

The session id is a 16-bit random value chosen by the host. Every frame after
the beacon is filtered on it, so two duels in the same room never collide.

**Pairing cannot use bump.** The badge's built-in Connect app pairs by
physically bumping two badges together, and that is the natural gesture for
starting a duel, but bump and sync are system frames: Lua "can neither emit
nor observe" them. Pairing is therefore beacon plus on-screen selection from
the PAIR list, ordered by signal strength so the nearest trainer sorts first.

### Validating hostile input

There is no `pcall`. A malformed frame from a stranger's badge is a fatal
error that suspends ticks, not an exception. Therefore, in `net.lua`:

1. Reject anything shorter than 4 bytes or not prefixed `KM1`.
2. Reject any kind byte outside the known set.
3. Reject any frame whose length does not exactly match its kind.
4. Read every field through one clamped accessor that returns 0 out of range.
5. Range-check every decoded value - species against 36, level against 127,
   pick against 3, slot against 3 - before it reaches `battle` or the
   renderer.
6. Reject a peer team whose three creatures are not three distinct types,
   and any type id outside 1-6.

Nothing outside `net.lua` ever sees a raw payload.

### Binary payload risk

The guide states `badge.fs` is binary safe. It says nothing about
`badge.radio`, and `monster.lua` packs NUL bytes. If binary payloads do not
survive, every frame hex-encodes instead: the largest grows from 21 to 42
bytes, still inside 44, and no other part of the design changes. Phase 0
settles this in twenty minutes.

### Rate limiting

Beacons only while the radio is explicitly on and the MAP screen is showing.
The ring drains 4 frames per tick at a nominal 20 ms cadence, about 200
frames per second, against roughly 25 per second from fifty beaconing badges.
`badge.radio.dropped()` is shown on the MAP screen as a diagnostic.

`badge.radio.disable()` takes about two seconds and needs its own RAM, so the
radio is an explicit toggle, never always on.
## 8. Catching

Two situations produce a catch attempt: a wild encounter, and the capture
phase after winning a duel. They share one probability function and one
throw grader.

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

### The shake window

Before every throw there is a **three second countdown, then a five second
shake window**. `badge.sensor.shake()` fires once per shake with a hardware
refractory period, so the window counts discrete shakes rather than
integrating acceleration.

```
shake_mult = 5 + 5 * min(1, shakes / SHAKE_TARGET)    -- tenths, 0.5x to 1.0x
```

`SHAKE_TARGET` starts at 12 shakes in five seconds and is a tuning knob. The
six LEDs fill as the meter charges and flash white at full, so the player
knows they can stop.

The window runs off `badge.sys.ms()`, not a tick counter, because ticks are
not guaranteed to arrive on time and pause entirely under HOME confirmation.
A resume gap over 300 ms abandons the window and restarts the countdown
rather than silently stealing the player's five seconds.

### Probability

One function, shared by wild encounters and duel captures, integer
arithmetic throughout and clamped to 5-95 percent so no attempt is hopeless
or certain:

```
chance = base(strength) * shake_mult * throw_mult * dex_bonus / 1000
```

- `base(strength)` falls as the creature's strength rises. Strength 1 is
  `70` percent, strength 10 is `8` percent, interpolated linearly between.
  This is the whole of "stronger pokemon are harder to catch"
- `shake_mult` 5 to 10 tenths, from the shake window
- `throw_mult` 10, 15 or 20, from the throw grade
- `dex_bonus` = `100 + 10 * min(5, copies_owned)`, capped at 150

Best case is a strength-1 creature at a full shake and an Excellent throw;
worst is a strength-10 creature barely shaken with a Nice throw. Every term
is a tuning knob and the numbers above are starting points, not balance.

Wild encounters give three balls and end after 30 seconds or when the
creature flees. A duel capture gives exactly one ball and one attempt.
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
| 0 | Pokestop chest: balls, XP, and a chance of a creature |
| 1-7 | Nest: family is `hash >> 3 % 8`, spawning that family's creatures |

Every sticker in the building becomes playable content with nothing to set
up, and the same sticker is the same place for every player - which is what
makes a nest worth telling a friend about.

**Every tag gives something.** The hash sets the flavour rather than pass or
fail, so no tap is ever wasted and the player never has to guess which
stickers are worth walking to:

| Flavour | Reward |
|---|---|
| Chest | 3-5 balls, XP, and a roughly 1-in-4 chance of a creature outright |
| Nest | A wild encounter of that tag's family, plus 1 ball and a little XP |

Chest creatures are granted, not thrown for - that is the point of a chest.
They skew to stage 1 and low strength, so a chest is a steady trickle rather
than a substitute for hunting.

NDEF text is still read and still honoured as an **override** when it
contains `stop` or `rocket`, so a player who does own an NFC writer can
author a Pokestop or arm a heist deliberately. It is a bonus path, never the
mechanism.

A nest's family is fixed by its UID; stage and level vary per visit.

### Only real stickers count

Hashing the UID of "any tag" is an infinite-reward exploit as written. **Many
payment cards and every phone emitting HCE present a randomized UID on each
tap**, so one credit card waved repeatedly reads as an endless supply of
brand-new Pokestops. The step cooldown does not help, because each tap looks
like a different tag.

`badge.nfc.card()` already returns the two fields that settle this. Accept a
tag as game content ONLY when:

- `sak == 0` and the UID is 7 bytes - the NTAG and Ultralight family, which
  is what event stickers are.
- The UID does not begin with `08`, the ISO 14443-3 marker for a randomly
  generated identifier.

Everything else - payment cards, transit passes, phones, hotel keys - reads
as "not a Pokestop" with a short message rather than silently minting
rewards. This costs four lines and closes the only unbounded economy in the
game.

Calibrate on the real stickers before trusting it: read one with the guide's
NFC Card Viewer example, confirm its SAK and UID length, and widen the filter
if the venue used something other than NTAG.

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
| 41 | 72 | Dex: 36 entries of (count, best level) |
| 113 | 336 | Tag log: up to 24 entries of 14 bytes |

About 449 bytes.

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

It would fit: 36 species at three characters each is 108 characters, inside
the 128-byte string cap. The cap is the reason not to - 42 species is where
that encoding runs out, so it puts a hard ceiling on the game and leaves no room for the tag log. The
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

**The order changed.** PvP was going to come before catching. It cannot: a
legal duel team is three distinct types, you start with a single starter, so
nobody can field a team until they have caught two more creatures. Collecting is now a hard prerequisite for dueling and ships first.

| Phase | Scope | Gate |
|---|---|---|
| 0 | Host mock harness; throwaway probe app | Binary radio payloads survive or they do not; accelerometer present; `badge.sys.stats()` after loading `dex.txt` |
| 1 | `dex.txt` and generator, art renderer, title, egg, hatch, starter pick, MAP, save | Staged widget construction finishes inside budget; `lua_peak` measured and recorded; save survives a reboot |
| 2 | Catching: steps, Walk mode, NFC nests, throw, bar fallback, dex browser | Catch rates tuned on hardware; a player can assemble three distinct types |
| 3 | Pokestop chests, ball economy, XP and trainer levels, evolution | Step-based cooldowns survive a reboot; the randomized-UID filter rejects a real payment card |
| 4 | Radio: beacons, pairing, commit-reveal duel, capture phase | Two badges; neither can see the other's pick before revealing; walk out of range mid-duel and both recover |
| 5 | Trading, Team Rocket heist, shinies, polish | Bundle still under 48 KiB |

Phase 0 exists because two unknowns cannot be settled on paper: whether the
radio carries binary, and what the real heap looks like with `dex.txt`
resident. Both change the design if they go the wrong way, and both are
cheaper to learn now than in phase 4.
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
runs 100 duels to completion, and asserts:

- Both sides agree on the winner, every time.
- **Neither side's state contains the peer's pick before it has broadcast
  its own commitment.** This is the cheat test, and it is the reason
  commit-reveal exists. Assert it directly on the app state, not on the UI.
- A mismatched reveal forfeits rather than crashing.
- At most one creature transfers, and only on a successful ball.
- Neither side errors.

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
| 12 families must stay visually distinct | Six palettes mean only two families share a colour; the generator varies body, head, limbs and crown independently - 192 combinations for 12 plans; stages add markings rather than changing plan |
| Losing creatures to strangers is grief-able over an anonymous channel | Nothing transfers on a loss alone - only a successful ball takes a creature, and only the duel winner throws. Starters are shielded and cannot be targeted |
| Trainer walks away mid-duel | 15 seconds without a peer frame shows connection lost and offers forfeit; nothing transfers |
| Sudden death plus a broadcast channel means a badge can hear the peer's pick before choosing | Commit-reveal with a 16-bit FNV commitment; asserted directly in `test_duel.lua`. Known ceiling: a purpose-built app could brute-force it |
| Forced Water/Fire/Grass locks new players out of dueling | Deliberate - it is the progression gate. PAIR names the missing type, and chests grant creatures so the trio is reachable without luck |
| Two AA alkalines, and the manual warns that low batteries cause glitches | `wake_lock` off by default and taken only in Walk mode and duels; Walk mode stops repainting and dims the LEDs; save on every meaningful event so a brownout costs at most one action |
| Steps cannot accrue in the background, so the GO-style walking loop is weakened | Spawn threshold cut to 40-80 steps; steps accrue on MAP too, not only in Walk mode; NFC stickers remain the primary spawn source |
| `badge.input.BUTTON.AUX1` exists in the enum but not on the board | Controls use only the eight physical buttons; asserted in the mock harness |

## 16. Explicitly out of scope

Deleted by the rock-paper-scissors duel: HP, damage formulas, IV-derived
stats, the move pool, move accuracy, turn order, speed, and the 16-type
effectiveness chart. Three types and one comparison replace all of it.

Never in scope: audio, because there is no Lua audio API at all - the LEDs
carry every piece of feedback. A scrolling tilemap overworld, because the
renderer would spend the memory the creatures need. Individual creature
instances with nicknames and per-catch IVs. 151 species. Items beyond balls.
Any network, Wi-Fi or HTTP feature, since none is exposed.
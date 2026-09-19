# KTNH Mon - design spec

Status: approved for implementation. Target: 2026 Hack the North Hacker Badge.

Sources: `docs/badge-ide-README.md` for the API contract, and
`badge.hackthenorth.com` plus the public Hacker Badge Instruction Manual for
the physical specification.

A creature collecting game in the shape of Pokemon GO, built for a 320x240
ESP32-C3 badge with a Lua OS. The real world supplies the map: NFC stickers
are nests and chests, walking spawns encounters, and other attendees' badges
are live opponents.

## 1. Locked decisions

| Decision | Value |
|---|---|
| Species | 36, six of each type |
| Types | Six, on a symmetric wheel: Water, Normal, Fire, Ice, Grass, Electric |
| Art | 16x16 grid, 4 palette indices, drawn as box-widget row runs |
| Opening | Title, egg, shake to hatch, pick one of three classic starters |
| Later eggs | Granted by chests, shaken open, yield any non-starter species |
| Wild spawns | NFC nest stickers, and walking |
| Chests | NFC tags that grant balls and eggs |
| Catch | Countdown, 5-second shake window, then an accelerometer throw |
| Duels | One round on the type wheel, sudden death, over radio |
| Duel teams | Any three distinct types |
| Duel reward | Winner picks ONE creature from the loser's whole collection and gets one capture attempt |
| Transfer | On a successful ball the loser loses it permanently. It stays in their Pokedex |
| Tiebreak | Higher strength; coin flip when equal |
| Ownership | A set, not a list. Duplicates bump a Pokedex count, they are not held twice |
| Wake lock | Off by manifest; taken at runtime in Walk mode and duels only |
| Tag roles | Derived from NFC UID hash, since the badge cannot write tags |

**No XP, no trainer levels, no creature levels, no evolution, no Team
Rocket, no HP and no damage.** Strength is an intrinsic property of the
species and is the only number a creature has.

The starter is shielded: it can never be targeted in a capture phase, so a
player can always recover from a losing streak by catching again.

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

Every limit below comes from `docs/badge-ide-README.md`. They are the budget,
not guidance.

| Resource | Limit |
|---|---|
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
the app, so every input from outside it - radio payloads, NFC text, saved
files, sensor returns - MUST be validated before use.

### Power budget, and what it does to the walking loop

Two constraints combine into a design problem that is easy to miss:

1. **Apps run only in the foreground.** A tick handler or radio listener
   stops the moment the player returns HOME. There is no background
   execution of any kind.
2. **The badge runs on two AA alkalines,** and the official manual tells
   attendees to "turn it off when not using it" because "low batteries cause
   glitches."

So a step counter that quietly accrues all weekend is impossible. Steps only
exist while this app is open, on screen, and holding a wake lock - the most
expensive way the badge can be run.

The design accommodates this rather than pretending otherwise:

- **`wake_lock` is 0 in the manifest** and taken at runtime with
  `badge.sys.wake_lock(true)` only in Walk mode and during an active duel.
- **Walk mode is an explicit screen.** Near-black UI, no per-tick repainting,
  one dim LED pulse every two seconds, nothing but the step meter.
- **The spawn threshold is a walk between rooms, not a marathon:** 40 to 80
  steps, roughly a minute.
- Steps also accrue free on any other screen while the app is open.

A corollary for troubleshooting: an app that dies or behaves strangely
mid-session may be flat batteries, not a bug.

## 3. Architecture

Eight files, plus an optional `icon.bin`, against the 16-file bundle cap.

| File | Responsibility | Depends on |
|---|---|---|
| `manifest.cfg` | slug `ktnh_mon`, `api=2`, `heap_kb=96`, `wake_lock=0`, `confirm_home=1` | - |
| `main.lua` | Lifecycle, screen router, input dispatch, LED driver | all |
| `dex.lua` | Species lookup, art decode, box-run renderer | - |
| `own.lua` | Ownership set, Pokedex counts, eggs, balls, persistence | `dex` |
| `duel.lua` | Team legality, commit-reveal, wheel resolution | `dex` |
| `net.lua` | Radio framing, beacons, pairing, duel frames | - |
| `catch.lua` | Throw grading, shake window, probability, step counter | - |
| `dex.txt` | 36 species | - |

**Deleted from the existing repo:** `app/monster.lua` and `app/fsm.lua`. The
5-byte packed record collapses to a single byte and needs no module, and the
mode machine is now a screen router small enough to live in `main.lua`.
`app/throw.lua` is absorbed into `catch.lua`.

### Module boundaries

Each module is testable on a host Lua with no badge present.

- `dex` takes a species id and returns name, type, strength and an art
  iterator. It touches widgets through one `paint(pool, id, x, y, cell_px)`
  entry point and nowhere else.
- `own` is the single owner of player state. Nothing else reads or writes
  the save.
- `duel` is pure: state in, state out, no rendering and no radio. It is
  about forty lines.
- `net` owns every byte that crosses the air. Nothing else calls
  `badge.radio`.
- `catch` is a streaming sensor consumer plus a probability function shared
  by wild encounters and duel captures, so both balance from one formula.

## 4. Screens

Ten screens, each a full-screen container box created once and shown or
hidden. Widgets are never recreated.

| Screen | Contents | Controls |
|---|---|---|
| TITLE | Logo, trainer name and role colour, loading state | A start |
| EGG | Egg from the art pool, shake meter | Shake to hatch |
| STARTER | One starter at a time as a carousel | LEFT/RIGHT cycle, A pick |
| MAP | Owned count, Pokedex progress, step meter, balls, eggs, nearby trainers, radio state | A scan, UP dex, DOWN collection, LEFT duel, RIGHT radio, START walk |
| WALK | Step count and meter only, near-black, low power | B back |
| ENCOUNTER | Wild creature art, name, type, strength, balls, countdown, shake meter, throw prompt or bar | Shake then throw, or A to stop the bar, B flee |
| DEX | Pokedex: 8 per page, name, type, times caught, silhouette if never caught | UP/DOWN page, A detail, B back |
| COLLECTION | What you currently hold, grouped by type, with the duel trio marked | UP/DOWN select, A set duel slot, B back |
| PAIR | Nearby trainers by signal; blocked with a reason if the trio is not legal | UP/DOWN select, A challenge, B back |
| DUEL | Four phases in one screen: pick, reveal, result, capture | LEFT/RIGHT pick, A confirm, HOME forfeit |

DEX and COLLECTION are different screens on purpose. The **Pokedex is
history** - every species you have ever captured, with a count, and it never
decreases. The **collection is present tense** - what you hold right now,
which shrinks when you lose a duel.

WALK is three widgets. DUEL shows one creature at a time, so it shares the
single art pool like every other screen. The capture phase reuses
ENCOUNTER's countdown, shake meter and throw widgets verbatim rather than
building a second set. One catch UI, one set of bugs.

### Widget budget and staged construction

One shared art pool of 48 boxes serves every screen, because no screen ever
shows two creatures at once - that is why STARTER is a carousel rather than
three side by side. Chrome is about 12 widgets per screen. Total is roughly
170 live widgets against a cap of 512.

Creating 170 widgets inside `on_enter` risks the 3,000 ms budget and fails
outright on old firmware. Instead `on_enter` builds only TITLE, then each
`on_tick` constructs the next batch of about 12 widgets until every screen
exists. The title screen IS the loading screen, and A is ignored until
construction finishes. This is the pattern the guide prescribes for large
boards.

## 5. Data format: `dex.txt`

One file, read once with `badge.fs.read`, held as a single string. Line
offsets are kept as integers and substrings are taken on demand. Splitting it
into 36 strings would roughly double its heap cost.

**36 species, six of each type.** Every species sits on the wheel; there is
no off-wheel type, because a creature that could never be fielded is dead
content.

Species line, space separated, about 285 bytes each:

```
id name type strength family art
04 EMBERKIT 3 7 2 0011100022...
```

- `type` is the creature's **position on the wheel**: 1 Water, 2 Normal,
  3 Fire, 4 Ice, 5 Grass, 6 Electric. The ordering is load-bearing - the
  duel resolver is modular arithmetic on this number
- `strength` is 1-10. It is the species' only stat, and it does two jobs:
  it sets capture difficulty and it breaks wheel ties
- `family` groups three species that share a body plan. **It has no gameplay
  meaning** - there is no evolution - it exists so the art generator can
  reuse a silhouette across three related creatures
- `art` is 256 characters: 16 rows of 16, row major, palette index per cell

Palette indices: `0` empty, `1` body, `2` shade, `3` accent for eyes and
markings. Colours are not stored; they come from the creature's type at
paint time, so one grid renders in six palettes.

**No move pool and no type chart.** The wheel is one modular subtraction; a
36-entry effectiveness table would be dead weight and could drift out of
sync with itself.

Total: 36 species at about 285 bytes, so roughly 10.3 KB. That clears the
16 KiB per-file read cap with 5.7 KB spare, and takes about 21 percent of the
Share bundle, leaving roughly 33 KB for Lua source.

Held in reserve, not done up front: packing two cells per hex character
halves the art to about 5.7 KB. Apply only if `badge.sys.stats()` or the
bundle size demands it, because packed art cannot be hand-edited while
creatures are still being tuned.

### Strength and rarity

Strength is the whole difficulty curve. It is assigned across the 36 so that
each type has a spread rather than a tier:

| Strength | Count per type | Base catch chance |
|---|---|---|
| 1-3 | 3 | 70% down to 50% |
| 4-7 | 2 | 40% down to 20% |
| 8-10 | 1 | 15% down to 8% |

So every type has one genuinely hard creature, and a strength-10 is a
trophy: hard to catch, wins every tie it enters, and worth taking off
somebody in a duel.

### Generated creatures

36 creatures, 12 families, generated by a parametric Python script kept in
`tools/gen_dex.py` and committed alongside its output.

Twelve distinct body plans is the real cost of 36, and it is art work rather
than budget. Six types help: the palette sorts creatures into six groups, so
only **two** families share each colour and have to be told apart by
silhouette. The generator varies four independent axes rather than picking
from a fixed list: **body** round, tall, squat or serpentine; **head**
merged, distinct or crested; **limbs** none, two, four or finned; **crown**
none, horns, long ears or antennae. That is 192 combinations, so twelve
genuinely distinct plans is comfortable.

The three species in a family share a plan and differ in size and markings,
so a family reads as a family even though it is not an evolution line.

No sourced sprite art. `badge.ui.image` requires an installed `.bin` and the
IDE's only image path produces a single 42x42 `icon.bin` for the launcher, so
downloaded art cannot reach the screen at all. Official Pokemon art is also
Nintendo's, and Share broadcasts the whole app directory to other badges,
which is distribution.

### Art rendering

A naive renderer would need one box per cell: 256 widgets for one creature,
half the entire cap. Instead each row is drawn as runs of a single colour.
Measured across generated species, a 16x16 creature averages 33 runs and
peaks around 40 - fewer boxes than a per-cell 8x8 renderer would need, at
four times the detail.

Painting is `set_pos`, `set_size`, `set_color` per run, roughly 120 native
calls. Unused boxes in the pool are hidden rather than deleted. On old
firmware, paint eight runs per tick and let the fill-in read as the
encounter reveal animation.

Cell size is an integer pixel count, so one grid serves every screen: 9 px
gives 144x144 for an encounter, 6 px gives 96x96 for a duel opponent, 3 px
gives a 48x48 Pokedex thumbnail.

## 6. Ownership model

This is the part that got radically simpler, and it is worth stating plainly
because almost everything else follows from it.

**A creature has no per-instance state.** No level, no XP, no IVs, no
nickname, no HP. Type and strength are properties of the species, looked up
from `dex.txt`. So "owning a Emberkit" is one bit, and a creature on the
wire is one byte: a species id from 1 to 36.

Player state is therefore four things:

| State | Representation | Size |
|---|---|---|
| What you hold now | Bitmap over 36 species | **5 bytes** |
| Pokedex: times captured | One saturating byte per species | 36 bytes |
| Your starter | A species id, permanently shielded | 1 byte |
| Balls and eggs | Two counters | 2 bytes |

Consequences worth naming:

- **Duplicates are not held twice.** Catching a species you already hold
  bumps its Pokedex count and nothing else. That is what "unlimited held
  pokemon" means in practice - there is nothing to limit, because the
  collection cannot exceed 36.
- **The whole collection fits in one radio frame.** Five bytes. That is what
  makes "the winner picks any of the loser's creatures" possible at all; a
  list of instances could not be transmitted.
- **The Pokedex never decreases.** Losing a duel clears a bit in the owned
  bitmap and leaves the count alone, which is exactly the rule you want: you
  can lose a creature but you can never lose the record of having caught it.
- Dex completion is "36 of 36 seen at least once" and is permanent. Holding
  all 36 at once is a separate, harder, losable achievement.

## 7. Duels

### Format

One round on the type wheel, sudden death.

**Both players field three creatures of three distinct types.** The app
refuses to open PAIR until the collection holds three different types and
says how many the player is short. This is the progression gate - you start
with one starter and must catch at least two other types before you can duel
anybody. Any three of the six qualify, so it gates on collecting breadth
rather than on specific luck.

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
circle, so the whole chart is arithmetic:

```lua
local d = (theirs - mine) % 6
-- d == 1 or d == 2  -> I win
-- d == 0 or d == 3  -> tie, fall through to strength
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

1. The wheel decides.
2. Tie, whether a mirror or the opposite-type tie: **higher strength wins.**
   That is one matchup in six, so it stays a tiebreak rather than the main
   event.
3. Equal strength as well: the host's RNG decides, and the frame says so.

Because both teams are exchanged before the pick, strength is public. A tie
outcome is therefore fully predictable, which makes it information the
player can use rather than a coin flip they resent.

### Capture phase

1. The winner browses **the loser's entire collection**, not just their duel
   trio, drawn from the 5-byte bitmap in the challenge frame. Grouped by
   type, with name, strength and Pokedex status.
2. The loser's **starter is not selectable.**
3. The winner picks one. Three second countdown, five second shake window,
   then the throw, exactly as a wild catch.
4. The host resolves and broadcasts the outcome. On success the species bit
   moves: set in the winner's collection, **cleared in the loser's**. The
   loser's Pokedex count is untouched.

A creature transfers ONLY on a successful ball. Losing a duel costs nothing
by itself.

**Losing below three types locks you out of dueling until you catch
again.** That is intended, not a bug - the starter shield guarantees you
always keep at least one creature and can always rebuild by catching. PAIR
says exactly what you are missing.

### Sync model

**Host-authoritative.** The host computes the reveal and the capture result
and broadcasts complete state. Every frame is idempotent and latest-wins, so
a dropped frame is repaired by the next one with no acknowledgement, no
sequence number and no retransmit timer.

### Commit and reveal

Sudden death makes this load-bearing. **Every badge in the room hears every
frame.** If the joiner broadcast its pick in the clear, the host's app would
hold that value before the host had chosen, and the duel would be decided by
whoever picked second.

So each side first broadcasts a commitment and reveals only after seeing the
peer's:

```
commit = fnv16(pick .. nonce)     -- nonce is a 16-bit random value
reveal = pick, nonce              -- peer recomputes and compares
```

A mismatched reveal forfeits. FNV-1a over 16 bits is not cryptography - a
purpose-built cheating app could brute-force three picks across 65,536
nonces. That is the known ceiling and it is the right one: about a dozen
lines, and it defeats every accidental and casual case. The upgrade path is
a wider hash, not a different protocol.

### Frames

Every frame starts with `KM1` and a one-byte kind. Payloads are binary.

| Kind | Sender | Payload | Bytes | Cadence |
|---|---|---|---|---|
| `B` beacon | any | short id (2), name (up to 8) | 14 | every 2,000 ms, MAP only |
| `C` challenge | host | sid (2), trio (3), collection bitmap (5) | 14 | every 500 ms until accepted |
| `A` accept | joiner | sid (2), trio (3), collection bitmap (5) | 14 | every 500 ms until a commit arrives |
| `H` commit | both | sid (2), commitment (2) | 8 | every 400 ms until the peer's commit is seen |
| `R` reveal | both | sid (2), pick (1), nonce (2) | 9 | every 400 ms until the result arrives |
| `S` result | host | sid (2), winner (1), picks (1), reason (1) | 9 | every 500 ms until a target arrives |
| `T` target | winner | sid (2), species (1) | 7 | every 400 ms until the outcome arrives |
| `E` outcome | host | sid (2), caught (1), species (1) | 8 | 5 times over 2 s |

Largest frame is 14 bytes against a 44-byte limit. Even hex-encoded as a
fallback that is 28 bytes, so the binary question cannot break the protocol.

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
5. Range-check every decoded value - species against 36, pick against 3 -
   before it reaches `duel` or the renderer.
6. Reject a peer trio that is not three distinct types, or any type id
   outside 1-6.
7. Reject a capture target that is not set in the peer's own collection
   bitmap, and reject their starter.

Nothing outside `net.lua` ever sees a raw payload.

### Binary payload risk

The guide states `badge.fs` is binary safe. It says nothing about
`badge.radio`. If binary payloads do not survive, every frame hex-encodes
instead: the largest grows from 14 to 28 bytes, still well inside 44, and no
other part of the design changes. Phase 0 settles this in twenty minutes.

### Rate limiting

Beacons only while the radio is explicitly on and MAP is showing. The ring
drains 4 frames per tick at a nominal 20 ms cadence, about 200 frames per
second, against roughly 25 per second from fifty beaconing badges.
`badge.radio.dropped()` is shown on MAP as a diagnostic.

`badge.radio.disable()` takes about two seconds and needs its own RAM, so the
radio is an explicit toggle, never always on.

## 8. Catching

Two situations produce a catch attempt: a wild encounter, and the capture
phase after winning a duel. They share one probability function, one throw
grader and one set of widgets.

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

- `base(strength)` falls as strength rises: 70 percent at strength 1, 8
  percent at strength 10, interpolated linearly. This is the whole of
  "stronger pokemon are harder to catch"
- `shake_mult` 5 to 10 tenths, from the shake window
- `throw_mult` 10, 15 or 20, from the throw grade
- `dex_bonus` = `100 + 10 * min(5, times_caught)`, capped at 150, so a
  species gets easier the more often you have caught it

Every term is a tuning knob and the numbers are starting points, not balance.

Wild encounters give three balls and end after 30 seconds or when the
creature flees. A duel capture gives exactly one ball and one attempt.

### Bar fallback

`badge.sensor.accel()` returns nil plus an error when the accelerometer is
unavailable. After three consecutive nil reads the encounter switches to a
bar that sweeps left and right; A stops it. The green window's width in
pixels is the same computed percentage, so the two mechanics balance from
one formula and there is nothing separate to tune. The shake window is
skipped in this mode and `shake_mult` is fixed at 10.

### Step counter

There is no step API. `catch.lua` derives steps from accelerometer
magnitude: deviation from calibrated gravity, peak detection with
hysteresis, and a 250 ms refractory period. A wild encounter spawns every
`40 + random(40)` steps - about a minute of walking, deliberately short, for
the battery reasons in section 2. The six LEDs fill clockwise as the meter
charges.

Step counting runs on MAP and in Walk mode only, so throwing the badge does
not also register as walking.

## 9. Eggs and hatching

The opening egg and every later egg use the same screen and the same shake
gesture.

**The first egg** is granted on first launch and hatches into a choice: one
Fire, one Water and one Grass starter, shown as a carousel. The player picks
one and it is permanently shielded.

**Later eggs** come from chests. They hatch into a single non-starter
species chosen by weighted random, biased away from strength:

```
weight(species) = 11 - strength
```

So a strength-1 creature is ten times likelier than a strength-10. Eggs are
a steady trickle toward the types you have not met, not a shortcut past
hunting. Hatching a species you already hold bumps the Pokedex count, the
same as any other catch.

Eggs are a counter, not objects - there is no incubator, no egg inventory
and no distance requirement. Hold as many as chests give you and shake them
open whenever.

## 10. NFC

NFC is power hungry and off by default. Enable in `on_enter`, handle failure
by disabling the nest and chest features and saying so on MAP. NDEF text
reads involve hardware work and are never done per tick - the app reads only
when `badge.nfc.card()` reports a UID it has not just seen.

### Roles come from the UID, not from authored tags

**The badge is a reader only and cannot write tags**, so a player has no way
to author their own - they would need a phone and blank NTAG stickers.
Meanwhile the venue is already covered in flower-pattern stickers for the
official Scanner app, whose NDEF payloads are Hack the North's and say
nothing about this game.

So the role is **derived from a hash of the tag UID**. Every sticker in the
building becomes playable content with nothing to set up, and the same
sticker is the same place for every player - which is what makes a nest
worth telling a friend about.

**Every tag gives something.** The hash sets the flavour rather than pass or
fail, so no tap is wasted and the player never has to guess which stickers
are worth walking to:

| Flavour | Frequency | Reward |
|---|---|---|
| Chest | 1 in 8 | 3-5 balls and 1 egg |
| Nest | 7 in 8 | A wild encounter of that tag's type, plus 1 ball |

A nest's type is fixed by its UID, so a given sticker always spawns the same
type. Which species within that type varies per visit.

### Only real stickers count

Hashing the UID of "any tag" is an infinite-reward exploit. **Many payment
cards and every phone emitting HCE present a randomized UID on each tap**, so
one credit card waved repeatedly reads as an endless supply of brand-new
chests. The step cooldown does not help, because each tap looks like a
different tag.

`badge.nfc.card()` already returns the fields that settle this. Accept a tag
as game content ONLY when:

- `sak == 0` and the UID is 7 bytes - the NTAG and Ultralight family, which
  is what event stickers are.
- The UID does not begin with `08`, the ISO 14443-3 marker for a randomly
  generated identifier.

Everything else - payment cards, transit passes, phones, hotel keys - reads
as "not a sticker" with a short message rather than silently minting
rewards. This costs four lines and closes the only unbounded economy in the
game.

Calibrate on the real stickers before trusting it: read one with the guide's
NFC Card Viewer example, confirm its SAK and UID length, and widen the
filter if the venue used something other than NTAG.

### Cooldowns without a clock

`badge.sys.ms()` is monotonic since boot and resets on reboot, so a
time-based cooldown does not survive power cycling. Cooldowns are measured
in **steps**: a tag is spent until the trainer has walked 100 more steps.
Steps are already persisted, so this survives reboot for free and ties the
economy to the walking loop.

The tag log lives in the save file: up to 24 entries of UID prefix plus the
step count at last visit, evicted least-recently-used.

## 11. Persistence

One binary file, `appdata/save.dat`, written through `badge.fs` which is
explicitly binary safe:

| Offset | Size | Contents |
|---|---|---|
| 0 | 1 | Format version, currently 1 |
| 1 | 1 | Starter species id |
| 2 | 5 | Collection: bitmap over 36 species |
| 7 | 36 | Pokedex: times captured per species, saturating at 255 |
| 43 | 4 | Lifetime steps, little endian |
| 47 | 1 | Balls held |
| 48 | 1 | Eggs held |
| 49 | 336 | Tag log: up to 24 entries of 14 bytes |

385 bytes.

`badge.store` holds only `sv`, the format version, as a cheap corruption
guard readable before the file load.

Write on: starter chosen, creature caught, creature lost, egg hatched, chest
collected, and `on_exit`. Never on a tick - the guide is explicit that flash
writes at frame rate also cost callback time.

Because there is no `pcall`, a truncated or absent file must not crash. Every
field read is length-checked first, and anything shorter than 43 bytes is
treated as a fresh save. Tell the user to leave through HOME rather than
powering off, since `on_exit` is not guaranteed to run.

### Why not `badge.store` for the whole save

It would fit today: the collection is 5 bytes and the Pokedex is 36. The cap
is the reason not to - `badge.store` strings are 128 bytes with no line
breaks, which leaves no room for the tag log and no headroom at all. The
file is binary safe and has none of those limits.

## 12. LED language

Six LEDs, Lua indices 1-based. Physical layout viewed from the front with
the screen upright: 1 upper left, 2 upper right, 3 middle right, 4 bottom
right, 5 bottom left, 6 middle left. Clockwise from upper left is
`{1,2,3,4,5,6}`.

| State | LEDs |
|---|---|
| Title | Slow breathe in `badge.me.color()` |
| Egg | Warm white, pulse rate rising with shake progress |
| Hatch | White flash, then the creature's type colour chasing clockwise |
| Map idle | Your rarest creature's type colour, slow breathe |
| Walk mode | One dim pulse every two seconds |
| Step meter | Clockwise fill, one LED per sixth of the spawn meter |
| Encounter | Species type colour, pulsing |
| Countdown | Three LEDs extinguishing, one per second |
| Shake window | Clockwise fill as the meter charges, white flash at full |
| Throw armed | All dim white |
| Nice / Great / Excellent | 1, 2 or 3 green flashes |
| Caught | Green clockwise chase |
| Fled | Two red pulses |
| Chest | Cyan spin, then one green LED per item granted |
| Radio scanning | Cyan sweep, white blip per beacon received |
| Duel pick | Your three types shown on LEDs 1, 6, 5 |
| Reveal | Both picks flash, yours left, theirs right |
| Win / loss | Winner's type colour wave, or a red fade |
| Creature lost | Slow red fade, one pulse per second, three seconds |

Stage a whole frame then call `badge.led.show()` once. Update at most every
80 ms, and derive each frame from `badge.sys.ms()` rather than a counter,
because ticks pause and the clock does not.

## 13. The `confirm_home` trap

`confirm_home=1` is set so a fumbled HOME cannot lose a duel. It pauses tick
delivery while the confirmation is open, `badge.sys.ms()` keeps advancing,
and Lua gets no cancel callback.

Rule: every tick computes `gap = now - last_tick`. When `gap > 300`, treat it
as a resume - reset the throw detector to recalibrate, abandon and restart
any countdown or shake window, credit no steps for the gap, and do not
advance a duel timeout. Without this the shake window drains during the
confirmation and the player loses a ball to a dialog.

## 14. Build phases

Each phase ends in a complete app that can be pushed and played. Each gate is
a thing to verify on hardware, not a feeling.

Collecting comes before dueling because a legal duel team is three distinct
types: nobody can duel until they have caught at least two creatures beyond
their starter.

| Phase | Scope | Gate |
|---|---|---|
| 0 | Host mock harness; throwaway probe app | Binary radio payloads survive or they do not; accelerometer present; `badge.sys.stats()` after loading `dex.txt` |
| 1 | `dex.txt` and generator, art renderer, title, first egg, starter pick, MAP, save | Staged widget construction finishes inside budget; `lua_peak` measured and recorded; save survives a reboot |
| 2 | Catching: steps, Walk mode, NFC nests, countdown, shake, throw, bar fallback, Pokedex and collection browsers | Catch rates tuned on hardware; a player can assemble three distinct types |
| 3 | Chests, ball economy, eggs and hatching | Step cooldowns survive a reboot; the randomized-UID filter rejects a real payment card |
| 4 | Radio: beacons, pairing, commit-reveal duel, capture phase, transfer | Two badges; neither can see the other's pick before revealing; walk out of range mid-duel and both recover; a transferred creature leaves one collection and joins the other exactly once |
| 5 | Trading, shinies, polish | Bundle still under 48 KiB |

Phase 0 exists because two unknowns cannot be settled on paper: whether the
radio carries binary, and what the real heap looks like with `dex.txt`
resident. Both change the design if they go the wrong way, and both are
cheaper to learn now than in phase 4.

## 15. Testing

No `pcall` on the badge means the host harness is the only place logic can
fail safely. Keep it.

**`test/mock_badge.lua`** builds a fake `badge` table and a `require` shim,
then drives the real `on_enter`, `on_tick`, `on_button` and `on_exit`. It
cannot see RAM or timing, but it catches state-machine, arithmetic and
protocol bugs in a second on a laptop. `luac -p` on every file is the syntax
gate.

**`test/test_wheel.lua`** asserts the four wheel properties from section 7
directly: 2 wins, 2 losses and 1 cross-tie for every type; antisymmetry; 24
of 36 pairings decisive; and all six canon relations. The resolver is one
line of modular arithmetic, and this is what stops a wrong wheel order
shipping.

**`test/test_duel.lua`** is the highest-value test in the project. It
instantiates two complete app states in one Lua process, wires their radios
together through a queue that drops 20 percent of frames and reorders some,
runs 100 duels to completion, and asserts:

- Both sides agree on the winner, every time.
- **Neither side's state contains the peer's pick before it has broadcast
  its own commitment.** This is the cheat test, and the reason commit-reveal
  exists. Assert it on app state, not on the UI.
- A mismatched reveal forfeits rather than crashing.
- At most one species bit transfers, only on a successful ball, and the
  loser's Pokedex count is unchanged.
- A starter is never a legal target.
- Neither side errors.

Additional asserted checks:

- Every coordinate and dimension handed to a widget is an integer.
- A truncated, empty and garbage `save.dat` all load as a fresh save.
- Every malformed radio payload class from section 7 is rejected before
  reaching `duel`.
- `badge.sensor.accel()` returning nil falls through to the bar.
- No control is ever bound to `AUX1`.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Physical RAM, not the quota, is the real ceiling. The guide records an app dying while compiling at 14 KB of source with `free=59588 largest=49152` before launch | Measure `badge.sys.stats()` at every phase gate. Art packing halves `dex.txt`. Raising `heap_kb` cannot fix it |
| Radio may not carry binary payloads | Phase 0 probe; hex encoding still only 28 bytes |
| A malformed frame is fatal with no `pcall` | Validate-first rule and clamped accessors, all inside `net.lua` |
| Old firmware gives 6 ms ticks | Batch every construction and paint loop; derive animation from `badge.sys.ms()` |
| 48 KiB Share bundle, of which `icon.bin` is 5,304 bytes | Track bundle size at every gate; art packing in reserve; drop `icon.bin` for a text icon if needed |
| 12 families must stay visually distinct | Six palettes mean only two families share a colour; the generator varies body, head, limbs and crown independently - 192 combinations for 12 plans |
| Two AA alkalines, and the manual warns that low batteries cause glitches | `wake_lock` off by default and taken only in Walk mode and duels; Walk mode stops repainting; save on every meaningful event so a brownout costs at most one action |
| Steps cannot accrue in the background | Spawn threshold cut to 40-80 steps; steps accrue on MAP too; stickers remain the primary spawn source |
| Sudden death on a broadcast channel means a badge can hear the peer's pick before choosing | Commit-reveal with a 16-bit FNV commitment, asserted in `test_duel.lua`. Known ceiling: a purpose-built app could brute-force it |
| Losing creatures to strangers is grief-able | Nothing transfers on a loss alone - only a successful ball, and only the winner throws. The starter can never be targeted, so a player can always rebuild |
| Dropping below three types locks a player out of dueling | Intended. The starter shield plus catching guarantees recovery, and PAIR names what is missing |
| `badge.input.BUTTON.AUX1` exists in the enum but not on the board | Controls use only the eight physical buttons; asserted in the mock harness |

## 17. Explicitly out of scope

Cut deliberately, and the game is smaller and better for it: **XP, trainer
levels, creature levels, evolution, Team Rocket, HP, damage, moves, move
accuracy, turn order, individual creature instances, IVs, nicknames, and any
per-instance state at all.** A creature is a species id. Strength is the
only number.

Never in scope: audio, because there is no Lua audio API - the LEDs carry
every piece of feedback. A scrolling tilemap overworld, because the renderer
would spend the memory the creatures need. 151 species. Any network, Wi-Fi
or HTTP feature, since none is exposed.

Deferred to phase 5 and deliberately unspecced: trading, and shinies.

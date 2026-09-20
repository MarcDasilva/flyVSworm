# Poke HTN — badge app

Tap an NFC sticker for an egg, shake the badge until it cracks, and whatever
hatches is saved to a Pokedex of 18 Kanto species.

This folder is the **built, badge-ready app**. Push all ten files to the badge.
`README.md` is the one filename the badge IDE does not push, so it stays here.

## Pushing

The slug must stay `ktnh_catch` — it is the directory name on the badge, and it
must match `manifest.cfg`. `name=` is what the launcher displays.

```
put /littlefs/apps/ktnh_catch/dex1.txt         384
put /littlefs/apps/ktnh_catch/dex2.txt         383
put /littlefs/apps/ktnh_catch/dex3.txt         381
put /littlefs/apps/ktnh_catch/dex4.txt         382
put /littlefs/apps/ktnh_catch/dex5.txt         378
put /littlefs/apps/ktnh_catch/dex6.txt         380
put /littlefs/apps/ktnh_catch/egg.txt          555
put /littlefs/apps/ktnh_catch/icon.bin        5304
put /littlefs/apps/ktnh_catch/main.lua       17408
put /littlefs/apps/ktnh_catch/manifest.cfg     186
reload
```

An editor that writes CRLF adds one byte per line; that is harmless, but it is
why a push may report slightly larger numbers.

## The files

| file | what it is |
| --- | --- |
| `main.lua` | the whole app, comments stripped |
| `manifest.cfg` | slug, launcher name, `heap_kb=96`, wake lock |
| `icon.bin` | 42x42 Pokeball, RGB565A8, for the launcher grid |
| `egg.txt` | the four egg frames and their palette |
| `dex1..6.txt` | 18 species, three per file: name, palette, packed 16x16 art |

Three species per file is deliberate. `badge.fs.read` wants several times a
file's size in transient heap, and that reserve competes directly with the art
pool — a larger chunk meant fewer pixels on screen.

## Rebuilding

Sources live in `catch/` on `main`, plus `app/egg.txt`. Do not push `catch/`
directly: its `main.lua` still has its comments and is roughly twice the size,
which does not fit.

```
python tools/bundle.py
```

## Notes for anyone reading the code

The app gets about 15 KB of usable heap after the Lua chunk loads, and three
decisions fall out of that:

- **The radio and the art pool are swapped at screen boundaries.** They want the
  same ~6 KB, and NFC shares an I2C bus with the accelerometer — with the radio
  enabled, shake detection returns nothing at all.
- **Sprite resolution is chosen per sprite at runtime.** `paint` counts the boxes
  a creature needs and picks the finest granularity the pool can hold, so the art
  degrades in detail rather than being clipped.
- **The Pokedex save is deferred** until the art pool has been released. Writing
  it mid-hatch failed outright: littlefs could not allocate a descriptor.

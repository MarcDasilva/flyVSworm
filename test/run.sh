#!/bin/sh
# Syntax gate first: luac -p catches what the badge would only find at push
# time, when the error card is the only diagnostic available.
set -e
for f in app/*.lua test/*.lua; do
  luac -p "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }
done
echo "syntax: OK"
for t in test/test_*.lua; do
  lua "$t" || { echo "TEST FAIL: $t"; exit 1; }
done
# Bundle size is not a test failure the badge reports: an over-cap app simply
# never arrives over Share. Gate it here so the task that busts it owns it,
# NOT Task 24 fifteen tasks later. Levers are in tools/bundle_check.sh.
./tools/bundle_check.sh > /dev/null || { ./tools/bundle_check.sh; exit 1; }
echo "bundle: OK"
echo "all tests passed"

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
echo "all tests passed"

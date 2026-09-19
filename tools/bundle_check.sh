#!/bin/sh
# Share caps the whole app directory at 48 KiB across 16 files. Exceeding it
# means other badges cannot receive the app at all, which is silent until
# someone tries.
set -e
LIMIT=49152
FILE_LIMIT=16
total=0
count=0
echo "file                       bytes"
for f in app/*; do
  n=$(wc -c < "$f")
  total=$((total + n))
  count=$((count + 1))
  printf "%-26s %6d\n" "$(basename "$f")" "$n"
done
# icon.bin is 5,304 bytes if the IDE image path is used. Budget for it even
# when it is not in the repo.
echo "---"
printf "%-26s %6d\n" "files" "$count"
printf "%-26s %6d\n" "total" "$total"
printf "%-26s %6d\n" "total + icon.bin" "$((total + 5304))"
printf "%-26s %6d\n" "limit" "$LIMIT"
[ "$count" -le "$FILE_LIMIT" ] || { echo "FAIL: too many files"; exit 1; }
[ "$((total + 5304))" -le "$LIMIT" ] || { echo "FAIL: bundle over 48 KiB"; exit 1; }
echo "bundle OK"

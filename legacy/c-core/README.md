Host-checkable C prototype of the 5-byte monster payload, badge FSM, and
throw detector. The Hacker Badge runs Lua, not this C. Kept as the wire
format spec.

gcc -std=c11 -Wall -Wextra -Werror -I include src/monster.c src/badge_fsm.c src/imu_throw.c test/host_check.c -o host_check

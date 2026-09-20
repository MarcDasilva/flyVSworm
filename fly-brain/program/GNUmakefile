# fly - the heading circuit running on Thru (see fly.h)
#
#   wsl -e bash -lc 'cd /mnt/c/.../fly-brain/program && \
#       RISCV_TOOLCHAIN_ROOT=$HOME/.thru/sdk/toolchain make'
#
# RISCV_TOOLCHAIN_ROOT is not optional when the source lives on /mnt/c. The
# SDK finds the toolchain by walking UP from the build directory looking for
# .thru/sdk/toolchain/bin, and from a Windows drive that walk reaches / without
# ever passing through the Linux home where it is actually installed. The error
# it gives -- "RISC-V toolchain not found - reached root directory" -- describes
# the search, not a missing install.
#
# The native half of the verification chain needs no toolchain at all:
#   gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && (cd . && /tmp/nt)
BASEDIR:=$(CURDIR)/build
THRU_C_SDK_DIR:=$(HOME)/.thru/sdk/c/thru-sdk
include $(THRU_C_SDK_DIR)/thru_c_program.mk

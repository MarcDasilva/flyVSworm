#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>

TSDK_ENTRYPOINT_FN void start(void) {
    unsigned long long marker = 0xC0FFEEULL;
    tsys_emit_event((unsigned char const *)&marker, sizeof(marker));
    tsdk_return(TSDK_SUCCESS);
}

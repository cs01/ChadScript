#include <string.h>
#include <stdlib.h>

double cs_lld_available(void) {
    return 0.0;
}

char* cs_lld_link_macho(const char* cmd_str) {
    (void)cmd_str;
    return strdup("lld not available (compiled without lld-bridge)");
}

char* cs_lld_link_elf(const char* cmd_str) {
    (void)cmd_str;
    return strdup("lld not available (compiled without lld-bridge)");
}

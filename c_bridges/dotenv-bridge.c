// dotenv-bridge.c — Loads .env files at binary startup.
// Called automatically from main() init. Silent no-op if .env is absent.
// Uses setenv(key, value, 0) so real environment variables take precedence.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void cs_load_dotenv(void) {
    FILE *f = fopen(".env", "r");
    if (!f) return;

    char line[4096];
    while (fgets(line, sizeof(line), f)) {
        // Strip trailing newline/carriage return
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
            line[--len] = '\0';
        }

        // Skip blank lines and comments
        if (len == 0 || line[0] == '#') continue;

        // Skip leading whitespace
        char *p = line;
        while (*p == ' ' || *p == '\t') p++;
        if (*p == '\0' || *p == '#') continue;

        // Find first '=' to split key=value
        char *eq = strchr(p, '=');
        if (!eq) continue;

        *eq = '\0';
        char *key = p;
        char *value = eq + 1;

        // Trim trailing whitespace from key
        char *kend = eq - 1;
        while (kend >= key && (*kend == ' ' || *kend == '\t')) {
            *kend-- = '\0';
        }

        // Skip leading whitespace on value
        while (*value == ' ' || *value == '\t') value++;

        // Strip matching quotes from value ("val" or 'val')
        size_t vlen = strlen(value);
        if (vlen >= 2) {
            if ((value[0] == '"' && value[vlen - 1] == '"') ||
                (value[0] == '\'' && value[vlen - 1] == '\'')) {
                value[vlen - 1] = '\0';
                value++;
            }
        }

        // setenv with overwrite=0: real env vars take precedence
        if (*key) {
            setenv(key, value, 0);
        }
    }

    fclose(f);
}

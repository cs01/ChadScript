#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static char *input;
static size_t pos, len;
static char *out;
static size_t out_pos, out_cap;

static void out_grow(size_t need) {
    while (out_pos + need >= out_cap) {
        out_cap *= 2;
        out = realloc(out, out_cap);
    }
}

static void out_char(char c) {
    out_grow(1);
    out[out_pos++] = c;
}

static void out_str(const char *s, size_t n) {
    out_grow(n);
    memcpy(out + out_pos, s, n);
    out_pos += n;
}

static void skip_ws(void) {
    while (pos < len) {
        char c = input[pos];
        if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
            pos++;
        } else if (c == '/' && pos + 1 < len && input[pos+1] == '/') {
            pos += 2;
            while (pos < len && input[pos] != '\n') pos++;
            if (pos < len) pos++;
        } else if (c == '/' && pos + 1 < len && input[pos+1] == '*') {
            pos += 2;
            while (pos + 1 < len && !(input[pos] == '*' && input[pos+1] == '/')) pos++;
            pos += 2;
        } else {
            return;
        }
    }
}

static void parse_value(void);

static void parse_string(void) {
    out_char('"');
    pos++;
    while (pos < len) {
        char c = input[pos];
        if (c == '\\') {
            out_char('\\');
            pos++;
            if (pos < len) { out_char(input[pos]); pos++; }
        } else if (c == '"') {
            out_char('"');
            pos++;
            return;
        } else {
            out_char(c);
            pos++;
        }
    }
}

static void parse_number(void) {
    size_t start = pos;
    if (pos < len && input[pos] == '-') pos++;
    while (pos < len && isdigit(input[pos])) pos++;
    if (pos < len && input[pos] == '.') {
        pos++;
        while (pos < len && isdigit(input[pos])) pos++;
    }
    if (pos < len && (input[pos] == 'e' || input[pos] == 'E')) {
        pos++;
        if (pos < len && (input[pos] == '+' || input[pos] == '-')) pos++;
        while (pos < len && isdigit(input[pos])) pos++;
    }
    out_str(input + start, pos - start);
}

static void parse_object(void) {
    pos++;
    out_char('{');
    skip_ws();
    int first = 1;
    while (pos < len && input[pos] != '}') {
        if (!first) out_char(',');
        first = 0;
        skip_ws();
        if (pos < len && input[pos] == '}') break;
        parse_string();
        skip_ws();
        if (pos < len && input[pos] == ':') pos++;
        out_char(':');
        skip_ws();
        parse_value();
        skip_ws();
        if (pos < len && input[pos] == ',') { pos++; skip_ws(); }
    }
    if (pos < len) pos++;
    out_char('}');
}

static void parse_array(void) {
    pos++;
    out_char('[');
    skip_ws();
    int first = 1;
    while (pos < len && input[pos] != ']') {
        if (!first) out_char(',');
        first = 0;
        skip_ws();
        if (pos < len && input[pos] == ']') break;
        parse_value();
        skip_ws();
        if (pos < len && input[pos] == ',') { pos++; skip_ws(); }
    }
    if (pos < len) pos++;
    out_char(']');
}

static void parse_value(void) {
    skip_ws();
    if (pos >= len) return;
    char c = input[pos];
    if (c == '"') parse_string();
    else if (c == '{') parse_object();
    else if (c == '[') parse_array();
    else if (c == '-' || isdigit(c)) parse_number();
    else if (c == 't') { out_str("true", 4); pos += 4; }
    else if (c == 'f') { out_str("false", 5); pos += 5; }
    else if (c == 'n') { out_str("null", 4); pos += 4; }
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: jsonc <file>\n"); return 1; }
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror(argv[1]); return 1; }
    fseek(f, 0, SEEK_END);
    len = ftell(f);
    fseek(f, 0, SEEK_SET);
    input = malloc(len + 1);
    fread(input, 1, len, f);
    input[len] = 0;
    fclose(f);

    pos = 0;
    out_cap = len * 2;
    out = malloc(out_cap);
    out_pos = 0;

    parse_value();
    out_char('\n');
    out_char(0);

    fputs(out, stdout);
    free(input);
    free(out);
    return 0;
}

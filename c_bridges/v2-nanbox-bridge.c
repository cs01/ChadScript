#include "cs2-alloc.h"
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

#define TAG_UNDEFINED 0x7FFC000000000001ULL
#define TAG_NULL      0x7FFC000000000002ULL
#define TAG_FALSE     0x7FFC000000000003ULL
#define TAG_TRUE      0x7FFC000000000004ULL
#define TAG_PTR       0x7FFD000000000000ULL
#define TAG_INT       0x7FFE000000000000ULL
#define TAG_STRING    0x7FFF000000000000ULL

#define MASK_QUIET    0x7FFC000000000000ULL
#define MASK_PAYLOAD  0x0000FFFFFFFFFFFFULL

static inline int is_double(uint64_t v) {
    return (v & MASK_QUIET) != MASK_QUIET;
}

uint64_t nanbox_from_f64(double val) {
    uint64_t bits;
    memcpy(&bits, &val, 8);
    return bits;
}

uint64_t nanbox_from_i64(int64_t val) {
    return TAG_INT | ((uint64_t)(int32_t)val & MASK_PAYLOAD);
}

uint64_t nanbox_from_bool(int val) {
    return val ? TAG_TRUE : TAG_FALSE;
}

uint64_t nanbox_from_string(const char *s) {
    return TAG_STRING | ((uint64_t)(uintptr_t)s & MASK_PAYLOAD);
}

uint64_t nanbox_from_ptr(void *p) {
    return TAG_PTR | ((uint64_t)(uintptr_t)p & MASK_PAYLOAD);
}

double nanbox_to_f64(uint64_t v) {
    if ((v & MASK_QUIET) == MASK_QUIET) {
        if ((v & 0xFFFF000000000000ULL) == TAG_INT) {
            int32_t ival = (int32_t)(v & MASK_PAYLOAD);
            if (v & 0x0000800000000000ULL) ival |= (int32_t)0xFFFF0000;
            return (double)ival;
        }
        return 0.0;
    }
    double d;
    memcpy(&d, &v, 8);
    return d;
}

int64_t nanbox_to_i64(uint64_t v) {
    if ((v & 0xFFFF000000000000ULL) == TAG_INT) {
        int32_t ival = (int32_t)(v & MASK_PAYLOAD);
        if (v & 0x0000800000000000ULL) ival |= (int32_t)0xFFFF0000;
        return (int64_t)ival;
    }
    if (is_double(v)) {
        double d;
        memcpy(&d, &v, 8);
        return (int64_t)d;
    }
    return 0;
}

int nanbox_to_bool(uint64_t v) {
    return v == TAG_TRUE ? 1 : 0;
}

const char *cs2_boxed_to_string(uint64_t v) {
    if ((v & 0xFFFF000000000000ULL) == TAG_STRING) {
        return (const char *)(uintptr_t)(v & MASK_PAYLOAD);
    }
    if (v == TAG_TRUE) return "true";
    if (v == TAG_FALSE) return "false";
    if (v == TAG_NULL) return "null";
    if (v == TAG_UNDEFINED) return "undefined";
    char *buf = (char *)malloc(32);
    if (is_double(v)) {
        double d;
        memcpy(&d, &v, 8);
        snprintf(buf, 32, "%g", d);
        return buf;
    }
    snprintf(buf, 32, "%lld", (long long)(v & MASK_PAYLOAD));
    return buf;
}

const char *nanbox_to_string(uint64_t v) {
    if ((v & 0xFFFF000000000000ULL) == TAG_STRING) {
        return (const char *)(uintptr_t)(v & MASK_PAYLOAD);
    }
    return "";
}

void *nanbox_to_ptr(uint64_t v) {
    if ((v & 0xFFFF000000000000ULL) == TAG_PTR) {
        return (void *)(uintptr_t)(v & MASK_PAYLOAD);
    }
    return NULL;
}

int nanbox_is_number(uint64_t v) {
    return is_double(v) || (v & 0xFFFF000000000000ULL) == TAG_INT;
}

int nanbox_is_string(uint64_t v) {
    return (v & 0xFFFF000000000000ULL) == TAG_STRING;
}

int nanbox_is_bool(uint64_t v) {
    return v == TAG_TRUE || v == TAG_FALSE;
}

int nanbox_is_null(uint64_t v) {
    return v == TAG_NULL;
}

int nanbox_is_undefined(uint64_t v) {
    return v == TAG_UNDEFINED;
}

int nanbox_is_ptr(uint64_t v) {
    return (v & 0xFFFF000000000000ULL) == TAG_PTR;
}

const char *nanbox_typeof(uint64_t v) {
    if (is_double(v)) return "number";
    if ((v & 0xFFFF000000000000ULL) == TAG_INT) return "number";
    if ((v & 0xFFFF000000000000ULL) == TAG_STRING) return "string";
    if (v == TAG_TRUE || v == TAG_FALSE) return "boolean";
    if (v == TAG_NULL) return "object";
    if (v == TAG_UNDEFINED) return "undefined";
    if ((v & 0xFFFF000000000000ULL) == TAG_PTR) return "object";
    return "undefined";
}

int nanbox_truthy(uint64_t v) {
    if (v == TAG_FALSE || v == TAG_NULL || v == TAG_UNDEFINED) return 0;
    if (v == TAG_TRUE) return 1;
    if ((v & 0xFFFF000000000000ULL) == TAG_STRING) {
        const char *s = (const char *)(uintptr_t)(v & MASK_PAYLOAD);
        return s && s[0] != '\0';
    }
    if ((v & 0xFFFF000000000000ULL) == TAG_INT) {
        int32_t ival = (int32_t)(v & MASK_PAYLOAD);
        if (v & 0x0000800000000000ULL) ival |= (int32_t)0xFFFF0000;
        return ival != 0;
    }
    if (is_double(v)) {
        double d;
        memcpy(&d, &v, 8);
        return d != 0.0 && !isnan(d);
    }
    return 1;
}

extern void cs2_print_number(double val);
extern void cs2_format_number(char *out, double val);

uint64_t nanbox_add(uint64_t a, uint64_t b) {
    if (nanbox_is_string(a) || nanbox_is_string(b)) {
        char bufa[64], bufb[64];
        const char *sa, *sb;
        if (nanbox_is_string(a)) {
            sa = nanbox_to_string(a);
        } else if (nanbox_is_number(a)) {
            cs2_format_number(bufa, nanbox_to_f64(a));
            sa = bufa;
        } else if (nanbox_is_bool(a)) {
            sa = (a == TAG_TRUE) ? "true" : "false";
        } else if (nanbox_is_null(a)) {
            sa = "null";
        } else if (nanbox_is_undefined(a)) {
            sa = "undefined";
        } else {
            sa = "";
        }
        if (nanbox_is_string(b)) {
            sb = nanbox_to_string(b);
        } else if (nanbox_is_number(b)) {
            cs2_format_number(bufb, nanbox_to_f64(b));
            sb = bufb;
        } else if (nanbox_is_bool(b)) {
            sb = (b == TAG_TRUE) ? "true" : "false";
        } else if (nanbox_is_null(b)) {
            sb = "null";
        } else if (nanbox_is_undefined(b)) {
            sb = "undefined";
        } else {
            sb = "";
        }
        size_t la = strlen(sa);
        size_t lb = strlen(sb);
        char *result = (char *)malloc(la + lb + 1);
        memcpy(result, sa, la);
        memcpy(result + la, sb, lb);
        result[la + lb] = '\0';
        return nanbox_from_string(result);
    }
    double da = nanbox_to_f64(a);
    double db = nanbox_to_f64(b);
    return nanbox_from_f64(da + db);
}

int nanbox_eq(uint64_t a, uint64_t b) {
    if (a == b) return 1;
    if (nanbox_is_number(a) && nanbox_is_number(b)) {
        return nanbox_to_f64(a) == nanbox_to_f64(b);
    }
    if (nanbox_is_string(a) && nanbox_is_string(b)) {
        return strcmp(nanbox_to_string(a), nanbox_to_string(b)) == 0;
    }
    return 0;
}

int nanbox_ne(uint64_t a, uint64_t b) {
    return !nanbox_eq(a, b);
}

int nanbox_lt(uint64_t a, uint64_t b) {
    if (nanbox_is_string(a) && nanbox_is_string(b)) {
        return strcmp(nanbox_to_string(a), nanbox_to_string(b)) < 0;
    }
    return nanbox_to_f64(a) < nanbox_to_f64(b);
}

int nanbox_le(uint64_t a, uint64_t b) {
    if (nanbox_is_string(a) && nanbox_is_string(b)) {
        return strcmp(nanbox_to_string(a), nanbox_to_string(b)) <= 0;
    }
    return nanbox_to_f64(a) <= nanbox_to_f64(b);
}

int nanbox_gt(uint64_t a, uint64_t b) {
    if (nanbox_is_string(a) && nanbox_is_string(b)) {
        return strcmp(nanbox_to_string(a), nanbox_to_string(b)) > 0;
    }
    return nanbox_to_f64(a) > nanbox_to_f64(b);
}

int nanbox_ge(uint64_t a, uint64_t b) {
    if (nanbox_is_string(a) && nanbox_is_string(b)) {
        return strcmp(nanbox_to_string(a), nanbox_to_string(b)) >= 0;
    }
    return nanbox_to_f64(a) >= nanbox_to_f64(b);
}

uint64_t nanbox_sub(uint64_t a, uint64_t b) {
    return nanbox_from_f64(nanbox_to_f64(a) - nanbox_to_f64(b));
}

uint64_t nanbox_mul(uint64_t a, uint64_t b) {
    return nanbox_from_f64(nanbox_to_f64(a) * nanbox_to_f64(b));
}

uint64_t nanbox_div(uint64_t a, uint64_t b) {
    return nanbox_from_f64(nanbox_to_f64(a) / nanbox_to_f64(b));
}

uint64_t nanbox_rem(uint64_t a, uint64_t b) {
    return nanbox_from_f64(fmod(nanbox_to_f64(a), nanbox_to_f64(b)));
}

uint64_t nanbox_neg(uint64_t a) {
    return nanbox_from_f64(-nanbox_to_f64(a));
}

uint64_t nanbox_to_string_val(uint64_t v) {
    if (nanbox_is_string(v)) return v;
    char buf[64];
    if (nanbox_is_number(v)) {
        cs2_format_number(buf, nanbox_to_f64(v));
    } else if (v == TAG_TRUE) {
        return nanbox_from_string("true");
    } else if (v == TAG_FALSE) {
        return nanbox_from_string("false");
    } else if (v == TAG_NULL) {
        return nanbox_from_string("null");
    } else if (v == TAG_UNDEFINED) {
        return nanbox_from_string("undefined");
    } else {
        return nanbox_from_string("[object Object]");
    }
    char *result = (char *)malloc(strlen(buf) + 1);
    strcpy(result, buf);
    return nanbox_from_string(result);
}

void nanbox_print(uint64_t v) {
    if (nanbox_is_string(v)) {
        puts(nanbox_to_string(v));
    } else if (nanbox_is_number(v)) {
        cs2_print_number(nanbox_to_f64(v));
        printf("\n");
    } else if (v == TAG_TRUE) {
        puts("true");
    } else if (v == TAG_FALSE) {
        puts("false");
    } else if (v == TAG_NULL) {
        puts("null");
    } else if (v == TAG_UNDEFINED) {
        puts("undefined");
    } else if (nanbox_is_ptr(v)) {
        puts("[object Object]");
    } else {
        puts("undefined");
    }
}

uint64_t nanbox_undefined(void) {
    return TAG_UNDEFINED;
}

uint64_t nanbox_null(void) {
    return TAG_NULL;
}

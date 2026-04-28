#include <stdlib.h>
#include <string.h>

typedef struct {
    int resolved;
    double f64_val;
    int64_t i64_val;
    void* ptr_val;
    int tag;
} ChadPromise;

ChadPromise* cs2_promise_new(void) {
    ChadPromise* p = (ChadPromise*)malloc(sizeof(ChadPromise));
    p->resolved = 0;
    p->f64_val = 0.0;
    p->i64_val = 0;
    p->ptr_val = NULL;
    p->tag = 5;
    return p;
}

void cs2_promise_resolve_f64(ChadPromise* p, double val) {
    p->resolved = 1;
    p->f64_val = val;
    p->tag = 0;
}

void cs2_promise_resolve_i64(ChadPromise* p, int64_t val) {
    p->resolved = 1;
    p->i64_val = val;
    p->tag = 1;
}

void cs2_promise_resolve_bool(ChadPromise* p, int val) {
    p->resolved = 1;
    p->i64_val = val;
    p->tag = 2;
}

void cs2_promise_resolve_ptr(ChadPromise* p, void* val) {
    p->resolved = 1;
    p->ptr_val = val;
    p->tag = 4;
}

void cs2_promise_resolve_str(ChadPromise* p, const char* val) {
    p->resolved = 1;
    p->ptr_val = (void*)val;
    p->tag = 3;
}

void cs2_promise_resolve_void(ChadPromise* p) {
    p->resolved = 1;
    p->tag = 5;
}

double cs2_promise_get_f64(ChadPromise* p) { return p->f64_val; }
int64_t cs2_promise_get_i64(ChadPromise* p) { return p->i64_val; }
int cs2_promise_get_bool(ChadPromise* p) { return (int)p->i64_val; }
void* cs2_promise_get_ptr(ChadPromise* p) { return p->ptr_val; }
const char* cs2_promise_get_str(ChadPromise* p) { return (const char*)p->ptr_val; }

typedef struct {
    double *data;
    int32_t length;
    int32_t capacity;
} NumArray;

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StrArray;

typedef struct {
    void **data;
    int32_t length;
    int32_t capacity;
} ObjArray;

ChadPromise* cs2_promise_all_num(ObjArray* promises) {
    NumArray* result = (NumArray*)malloc(sizeof(NumArray));
    result->length = promises->length;
    result->capacity = promises->length < 4 ? 4 : promises->length;
    result->data = (double*)malloc(sizeof(double) * result->capacity);
    for (int32_t i = 0; i < promises->length; i++) {
        ChadPromise* p = (ChadPromise*)promises->data[i];
        result->data[i] = (p->tag == 1) ? (double)p->i64_val : p->f64_val;
    }
    ChadPromise* out = cs2_promise_new();
    cs2_promise_resolve_ptr(out, (void*)result);
    return out;
}

ChadPromise* cs2_promise_all_str(ObjArray* promises) {
    StrArray* result = (StrArray*)malloc(sizeof(StrArray));
    result->length = promises->length;
    result->capacity = promises->length < 4 ? 4 : promises->length;
    result->data = (char**)malloc(sizeof(char*) * result->capacity);
    for (int32_t i = 0; i < promises->length; i++) {
        ChadPromise* p = (ChadPromise*)promises->data[i];
        result->data[i] = (char*)p->ptr_val;
    }
    ChadPromise* out = cs2_promise_new();
    cs2_promise_resolve_ptr(out, (void*)result);
    return out;
}

ChadPromise* cs2_promise_race_num(ObjArray* promises) {
    if (promises->length == 0) {
        return cs2_promise_new();
    }
    ChadPromise* first = (ChadPromise*)promises->data[0];
    ChadPromise* out = cs2_promise_new();
    double val = (first->tag == 1) ? (double)first->i64_val : first->f64_val;
    cs2_promise_resolve_f64(out, val);
    return out;
}

ChadPromise* cs2_promise_race_str(ObjArray* promises) {
    if (promises->length == 0) {
        return cs2_promise_new();
    }
    ChadPromise* first = (ChadPromise*)promises->data[0];
    ChadPromise* out = cs2_promise_new();
    cs2_promise_resolve_str(out, (const char*)first->ptr_val);
    return out;
}


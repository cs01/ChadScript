#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define ARENA_CHUNK_SIZE (16 * 1024 * 1024)
#define ARENA_ALIGN 16

typedef struct ArenaChunk {
    char *base;
    size_t cap;
    size_t used;
    struct ArenaChunk *next;
} ArenaChunk;

static ArenaChunk *g_head = NULL;
static ArenaChunk *g_cur = NULL;

static ArenaChunk *new_chunk(size_t min_size) {
    size_t cap = ARENA_CHUNK_SIZE;
    if (min_size > cap) cap = min_size;
    ArenaChunk *c = (ArenaChunk *)malloc(sizeof(ArenaChunk));
    c->base = (char *)malloc(cap);
    c->cap = cap;
    c->used = 0;
    c->next = NULL;
    return c;
}

static void ensure_init(void) {
    if (g_head == NULL) {
        g_head = new_chunk(0);
        g_cur = g_head;
    }
}

void *cs2_arena_alloc(int64_t size) {
    ensure_init();
    size_t s = (size_t)size;
    s = (s + (ARENA_ALIGN - 1)) & ~(size_t)(ARENA_ALIGN - 1);
    if (g_cur->used + s > g_cur->cap) {
        if (g_cur->next == NULL) {
            g_cur->next = new_chunk(s);
        } else if (g_cur->next->cap < s) {
            ArenaChunk *bigger = new_chunk(s);
            bigger->next = g_cur->next->next;
            free(g_cur->next->base);
            free(g_cur->next);
            g_cur->next = bigger;
        }
        g_cur = g_cur->next;
        g_cur->used = 0;
    }
    void *p = g_cur->base + g_cur->used;
    g_cur->used += s;
    return p;
}

typedef struct {
    ArenaChunk *chunk;
    size_t used;
} ArenaMark;

static ArenaMark g_mark_stack[256];
static int g_mark_top = 0;

void cs2_arena_save(void) {
    ensure_init();
    if (g_mark_top >= 256) return;
    g_mark_stack[g_mark_top].chunk = g_cur;
    g_mark_stack[g_mark_top].used = g_cur->used;
    g_mark_top++;
}

void cs2_arena_restore(void) {
    if (g_mark_top == 0) return;
    g_mark_top--;
    g_cur = g_mark_stack[g_mark_top].chunk;
    g_cur->used = g_mark_stack[g_mark_top].used;
}

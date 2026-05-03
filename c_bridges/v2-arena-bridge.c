#include <string.h>
#include <stdint.h>
#include <stddef.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

#define ARENA_CHUNK_SIZE (1024 * 1024)
#define ARENA_ALIGN 8

typedef struct ArenaChunk {
    char *data;
    size_t used;
    size_t cap;
    struct ArenaChunk *next;
} ArenaChunk;

static ArenaChunk *g_cur = NULL;
static ArenaChunk *g_head = NULL;

static ArenaChunk *new_chunk(size_t min_size) {
    size_t cap = min_size > ARENA_CHUNK_SIZE ? min_size : ARENA_CHUNK_SIZE;
    ArenaChunk *c = (ArenaChunk *)GC_malloc(sizeof(ArenaChunk));
    c->data = (char *)GC_malloc_atomic(cap);
    c->used = 0;
    c->cap = cap;
    c->next = g_head;
    g_head = c;
    return c;
}

void *cs2_arena_alloc(int64_t size) {
    size_t s = (size_t)size;
    s = (s + (ARENA_ALIGN - 1)) & ~(size_t)(ARENA_ALIGN - 1);
    if (!g_cur || g_cur->used + s > g_cur->cap) {
        g_cur = new_chunk(s);
    }
    void *p = g_cur->data + g_cur->used;
    g_cur->used += s;
    return p;
}

void cs2_arena_reset(void) {
    g_cur = NULL;
    g_head = NULL;
}

typedef struct {
    ArenaChunk *chunk;
    size_t used;
} ArenaMark;

static ArenaMark g_mark_stack[256];
static int g_mark_top = 0;

void cs2_arena_save(void) {
    if (g_mark_top >= 256) return;
    g_mark_stack[g_mark_top].chunk = g_cur;
    g_mark_stack[g_mark_top].used = g_cur ? g_cur->used : 0;
    g_mark_top++;
}

void cs2_arena_restore(void) {
    if (g_mark_top == 0) return;
    g_mark_top--;
    g_cur = g_mark_stack[g_mark_top].chunk;
    if (g_cur) g_cur->used = g_mark_stack[g_mark_top].used;
}

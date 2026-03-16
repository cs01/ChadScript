#include <string.h>
#include <stdint.h>

extern void* GC_malloc(size_t);
extern void* GC_malloc_atomic(size_t);

#define ARENA_BLOCK_SIZE (1024 * 1024)

typedef struct ArenaBlock {
    char* data;
    size_t used;
    size_t capacity;
    struct ArenaBlock* next;
} ArenaBlock;

static ArenaBlock* current_block = NULL;
static ArenaBlock* block_list = NULL;

static ArenaBlock* arena_new_block(size_t min_size) {
    size_t cap = min_size > ARENA_BLOCK_SIZE ? min_size : ARENA_BLOCK_SIZE;
    ArenaBlock* block = (ArenaBlock*)GC_malloc(sizeof(ArenaBlock));
    block->data = (char*)GC_malloc_atomic(cap);
    block->used = 0;
    block->capacity = cap;
    block->next = block_list;
    block_list = block;
    return block;
}

void* cs_arena_alloc(size_t size) {
    size = (size + 7) & ~(size_t)7;

    if (!current_block || current_block->used + size > current_block->capacity) {
        current_block = arena_new_block(size);
    }

    void* ptr = current_block->data + current_block->used;
    current_block->used += size;
    return ptr;
}

void cs_arena_reset(void) {
    current_block = NULL;
    block_list = NULL;
}

# Phase 5: Full Boehm GC Replacement — Incremental Path

Key insight: Hide GcHeader behind the pointer. Allocate 8 + sizeof(struct), return
ptr + 8. All existing GEPs unchanged. Read header via ptr - 8.

Memory layout:  [GcHeader 8 bytes][struct data...]
Returned ptr:                      ^-- here

GcHeader struct:
```c
typedef struct {
    uint8_t obj_type;    // STRING, ARRAY, OBJECT, CLOSURE, MAP, SET, etc.
    uint8_t gc_flags;    // MARKED, ARENA, PINNED
    uint16_t _reserved;
    uint32_t size;       // total allocation size (header + payload)
} GcHeader;
```

## Step 1: arena-gc-bridge.c (~300 lines)
- Bump allocator with 8MB blocks, prepends GcHeader, returns ptr+8
- Same signature as GC_malloc — drop-in replacement
- Arena blocks initially backed by GC_malloc (Boehm still running)
- Functions: cs_gc_alloc(size, type), cs_gc_alloc_atomic(size, type)

## Step 2: Swap allocation sites (one at a time)
- Each swap is a one-line codegen change: GC_malloc → cs_gc_alloc
- Order: strings → numeric array data → class instances → closures → maps/sets
- Run npm run verify:quick after each swap
- Boehm still handles collection — arena blocks are GC-managed, no leaks

## Step 3: Add root registration
- Emit cs_gc_register_root(&global) for each module-level variable in codegen
- ~10 lines change in function-generator.ts (main function preamble)
- Store roots in a simple global array in the C bridge

## Step 4: Implement mark-sweep in the C bridge
- Conservative stack scan: setjmp to capture registers, walk SP→stack_bottom
- Validate candidates against known heap pointers (arena walk + malloc list)
- Worklist-based tracing: follow pointers in marked objects (type-specific via obj_type)
- Sweep: free unmarked objects, add arena slots to free list
- Trigger: check threshold on each arena block allocation (e.g., 64MB)
- This is ~500 lines of C, entirely in the bridge — zero codegen changes

## Step 5: Remove Boehm
- Stop linking -lgc
- Delete GC_malloc/GC_realloc/GC_disable declarations from llvm-declarations.ts
- Replace any remaining GC_realloc with cs_gc_realloc (alloc new + memcpy)
- Binary shrinks by ~150KB, loses 713 symbols

Verification at each step: npm run verify (tests + full self-hosting). Each step is a single PR.

## Tracing rules by type
- STRING, BIGINT: leaf nodes, no children to trace
- ARRAY (numeric): leaf node (double* contains no pointers)
- ARRAY (string/object): scan elements as pointers
- OBJECT (class instance): scan all pointer-typed fields via field count in struct
- CLOSURE: scan captured variables
- MAP/SET: scan entry key-value pairs
- PROMISE: scan value/reason/callbacks

---
The Phase 1-3 work (arena for strings/arrays backed by GC_malloc) is the foundation — all of that stays.
This plan just adds headers, root tracking, and mark-sweep on top, then removes Boehm.

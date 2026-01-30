/**
 * Boehm GC Runtime Generator
 *
 * Generates LLVM IR declarations for the Boehm garbage collector.
 * This replaces manual malloc/free with automatic garbage collection.
 *
 * The Boehm GC is a conservative garbage collector that works as a
 * drop-in replacement for malloc. It scans the stack and heap for
 * pointers and automatically frees unreachable memory.
 *
 * Library: libgc (bdwgc)
 * Location: /data/users/cssmith/git/bdwgc/libgc.a
 */
export class GCGenerator {
  /**
   * Generate external declarations for Boehm GC functions
   */
  generateDeclarations(): string {
    let ir = '; Boehm GC (libgc) declarations\n';
    ir += '; Conservative garbage collector - replaces malloc/free\n\n';

    ir += 'declare void @GC_init()\n';
    ir += 'declare i8* @GC_malloc(i64)\n';
    ir += 'declare i8* @GC_malloc_atomic(i64)\n';
    ir += 'declare i8* @GC_realloc(i8*, i64)\n';
    ir += 'declare void @GC_free(i8*)\n';
    ir += 'declare void @GC_gcollect()\n';
    ir += 'declare i64 @GC_get_heap_size()\n';
    ir += 'declare void @GC_enable_incremental()\n';
    ir += '\n';

    return ir;
  }

  /**
   * Generate GC initialization call for main() entry point
   * This should be called at the very start of main()
   */
  generateInit(): string {
    return '  call void @GC_init()\n';
  }

  /**
   * Generate a GC-managed allocation (replaces malloc)
   * @param sizeReg - Register containing the size to allocate
   * @param resultReg - Register to store the result pointer
   */
  generateAlloc(sizeReg: string, resultReg: string): string {
    return `  ${resultReg} = call i8* @GC_malloc(i64 ${sizeReg})\n`;
  }

  /**
   * Generate a GC-managed atomic allocation (for memory without pointers)
   * This is more efficient for strings and primitive arrays
   * @param sizeReg - Register containing the size to allocate
   * @param resultReg - Register to store the result pointer
   */
  generateAtomicAlloc(sizeReg: string, resultReg: string): string {
    return `  ${resultReg} = call i8* @GC_malloc_atomic(i64 ${sizeReg})\n`;
  }

  /**
   * Generate a GC-managed reallocation
   * @param ptrReg - Register containing the pointer to reallocate
   * @param sizeReg - Register containing the new size
   * @param resultReg - Register to store the result pointer
   */
  generateRealloc(ptrReg: string, sizeReg: string, resultReg: string): string {
    return `  ${resultReg} = call i8* @GC_realloc(i8* ${ptrReg}, i64 ${sizeReg})\n`;
  }
}

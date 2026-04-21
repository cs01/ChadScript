// FFI declares for c_bridges/llvm-builder-bridge.c — the Step 4 IRBuilder
// C-API path. No codegen sites call these yet; this file exists to (a) exercise
// the linkage contract, (b) let future codegen flips import a stable API, and
// (c) track bridge coverage against the emit-site audit.
//
// See memory/step4-irbuilder-design-2026-04-20.md for the full plan.
//
// Bridge state machine (set by the compiler driver, not the codegen helpers):
//   1. cs_llvm_builder_init(moduleName, triple) — once per compilation
//   2. cs_llvm_add_struct_type / add_function / add_extern — type + symbol decls
//   3. Per function:
//        cs_llvm_fn_begin(name)
//        cs_llvm_bb_create / bb_position
//        cs_llvm_build_* — one call per LLVM instruction
//        cs_llvm_fn_end()
//   4. cs_llvm_builder_print() — dump the module as LLVM IR text
//   5. cs_llvm_builder_optimize / emit_object — optional lowering
//   6. cs_llvm_builder_dispose() — release globals
//
// The bridge is already linked into the native compiler binary; these declares
// only surface the symbols to TypeScript callers.

// ---- Module lifecycle ----

export declare function cs_llvm_builder_init(moduleName: string, triple: string): void;
export declare function cs_llvm_builder_dispose(): void;
export declare function cs_llvm_builder_print(): string;
export declare function cs_llvm_builder_optimize(level: number): void;
export declare function cs_llvm_builder_emit_object(path: string): void;

// ---- Type / symbol decls ----

export declare function cs_llvm_add_struct_type(
  name: string,
  fieldTypesCsv: string,
  fieldCount: number,
): void;
export declare function cs_llvm_add_function(
  name: string,
  retTypeStr: string,
  paramTypesCsv: string,
  paramCount: number,
): void;
export declare function cs_llvm_add_extern(
  name: string,
  retTypeStr: string,
  paramTypesCsv: string,
  paramCount: number,
): void;
export declare function cs_llvm_add_global_string(name: string, value: string): void;

// ---- Function / block scaffolding ----

export declare function cs_llvm_fn_begin(name: string): void;
export declare function cs_llvm_fn_end(): void;
export declare function cs_llvm_fn_set_param_name(idx: number, name: string): void;
export declare function cs_llvm_bb_create(name: string): void;
export declare function cs_llvm_bb_position(name: string): void;

// ---- Arithmetic (integer) ----

export declare function cs_llvm_build_add(lhs: string, rhs: string): string;
export declare function cs_llvm_build_sub(lhs: string, rhs: string): string;
export declare function cs_llvm_build_mul(lhs: string, rhs: string): string;
export declare function cs_llvm_build_srem(lhs: string, rhs: string): string;

// ---- Arithmetic (float) ----

export declare function cs_llvm_build_fadd(lhs: string, rhs: string): string;
export declare function cs_llvm_build_fsub(lhs: string, rhs: string): string;
export declare function cs_llvm_build_fmul(lhs: string, rhs: string): string;
export declare function cs_llvm_build_fdiv(lhs: string, rhs: string): string;

// ---- Bitwise (added this PR) ----

export declare function cs_llvm_build_and(lhs: string, rhs: string): string;
export declare function cs_llvm_build_or(lhs: string, rhs: string): string;
export declare function cs_llvm_build_xor(lhs: string, rhs: string): string;
export declare function cs_llvm_build_shl(lhs: string, rhs: string): string;
export declare function cs_llvm_build_ashr(lhs: string, rhs: string): string;
export declare function cs_llvm_build_lshr(lhs: string, rhs: string): string;

// ---- Memory ----

export declare function cs_llvm_build_alloca(typeStr: string): string;
export declare function cs_llvm_build_load(typeStr: string, ptr: string): string;
export declare function cs_llvm_build_store(typeStr: string, value: string, ptr: string): void;
export declare function cs_llvm_build_gep(
  typeStr: string,
  ptr: string,
  indicesCsv: string,
  indexCount: number,
): string;

// ---- Casts ----

export declare function cs_llvm_build_bitcast(value: string, destType: string): string;
export declare function cs_llvm_build_sext(value: string, destType: string): string;
export declare function cs_llvm_build_zext(value: string, destType: string): string;
export declare function cs_llvm_build_trunc(value: string, destType: string): string;
export declare function cs_llvm_build_sitofp(value: string, destType: string): string;
export declare function cs_llvm_build_fptosi(value: string, destType: string): string;
export declare function cs_llvm_build_inttoptr(value: string, destType: string): string;
export declare function cs_llvm_build_ptrtoint(value: string, destType: string): string;

// ---- Control flow ----

export declare function cs_llvm_build_br(label: string): void;
export declare function cs_llvm_build_br_cond(
  cond: string,
  thenLabel: string,
  elseLabel: string,
): void;
export declare function cs_llvm_build_ret(typeStr: string, value: string): void;
export declare function cs_llvm_build_ret_void(): void;
export declare function cs_llvm_build_unreachable(): void;

// ---- Comparison + ternary ----

export declare function cs_llvm_build_icmp(pred: string, lhs: string, rhs: string): string;
export declare function cs_llvm_build_fcmp(pred: string, lhs: string, rhs: string): string;
export declare function cs_llvm_build_select(
  cond: string,
  thenVal: string,
  elseVal: string,
): string;
export declare function cs_llvm_build_phi(
  typeStr: string,
  valuesCsv: string,
  blocksCsv: string,
  count: number,
): string;

// ---- Calls ----

export declare function cs_llvm_build_call(
  funcName: string,
  argsCsv: string,
  argCount: number,
): string;
export declare function cs_llvm_build_call_void(
  funcName: string,
  argsCsv: string,
  argCount: number,
): void;

// ---- Audit: patterns NOT yet covered by bridge ----
//
// As of this PR, `scripts/audit-emit-sites.sh` reports these uncovered patterns
// in src/codegen/:
//
//   sdiv    (4 sites)
//   uitofp  (15 sites)
//   fptrunc (1 site)
//   fpext   (1 site)
//   dynamic ${op} templates  (2 sites — variable opcode, needs investigation)
//
// Followup PRs add the corresponding cs_llvm_build_* wrappers.

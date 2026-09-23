// Every runtime entry point the emitted module may call, declared in one place.
//
// Split out of codegen.ts to keep that file under the size ratchet (tests/unit/file-size.test.ts):
// this list grows with every runtime feature, so it was the part that kept pushing the file over.
// tests/unit/runtime-externs.test.ts checks the list against what the lowering tables actually
// emit — a missing entry here is otherwise a clang "use of undefined value" at link time rather
// than a test failure.

import type { ModuleBuilder } from "../ir/builder.js";
import { T } from "../ir/types.js";

export function declareRuntimeExterns(mod: ModuleBuilder): void {
  mod.declareExtern("cs_print_cstr", T.void, [T.ptr]);
  mod.declareExtern("cs_print_f64", T.void, [T.double]);
  mod.declareExtern("cs_print_bool", T.void, [T.i32]);
  mod.declareExtern("cs_print_space", T.void, []);
  mod.declareExtern("cs_print_newline", T.void, []);
  mod.declareExtern("cs_to_int32", T.i32, [T.double]); // ECMAScript ToInt32 for bitwise ops
  mod.declareExtern("cs_str_concat", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_json_num", T.ptr, [T.double]);
  mod.declareExtern("cs_json_str", T.ptr, [T.ptr]);
  mod.declareExtern("cs_num_to_string", T.ptr, [T.double]);
  mod.declareExtern("cs_num_to_string_radix", T.ptr, [T.double, T.double]);
  mod.declareExtern("cs_string_to_number", T.double, [T.ptr]);
  mod.declareExtern("cs_inspect_num", T.ptr, [T.double]);
  mod.declareExtern("cs_inspect_str", T.ptr, [T.ptr, T.i32]);
  // util.inspect layout (runtime/inspect.milo).
  mod.declareExtern("cs_insp_circular", T.ptr, [T.ptr]);
  mod.declareExtern("cs_insp_push", T.void, [T.ptr, T.i32]);
  mod.declareExtern("cs_insp_set_mode", T.void, [T.i32, T.i32]);
  // util.format's substitution loop (runtime/format.milo): (firstIsString, first, nargs, thunk,
  // env) -> the line; codegen/console-format.ts emits the per-call-site thunk.
  mod.declareExtern("cs_console_format", T.ptr, [T.i32, T.ptr, T.i32, T.ptr, T.ptr]);
  mod.declareExtern("cs_insp_max_depth", T.i32, []);
  mod.declareExtern("cs_insp_show_hidden", T.i32, []);
  mod.declareExtern("cs_insp_finish", T.ptr, [T.ptr, T.ptr, T.i32, T.ptr, T.ptr, T.i32, T.i32]);
  mod.declareExtern("cs_bool_to_string", T.ptr, [T.i32]);
  mod.declareExtern("cs_str_eq", T.i32, [T.ptr, T.ptr]);
  // Value words (runtime/value.milo).
  mod.declareExtern("cs_value_strict_eq", T.i32, [T.i64, T.i64]);
  mod.declareExtern("cs_value_same_zero", T.i32, [T.i64, T.i64]);
  mod.declareExtern("cs_value_mismatch", T.void, []);
  // Math.* : libm (double→double) + JS-semantics helpers.
  for (const f of ["floor", "ceil", "trunc", "sqrt", "fabs", "cs_math_round", "cs_math_sign"]) {
    mod.declareExtern(f, T.double, [T.double]);
  }
  mod.declareExtern("pow", T.double, [T.double, T.double]);
  mod.declareExtern("cs_math_max2", T.double, [T.double, T.double]);
  mod.declareExtern("cs_math_min2", T.double, [T.double, T.double]);
  // String methods.
  mod.declareExtern("cs_str_len", T.i32, [T.ptr]);
  for (const f of [
    "cs_str_upper",
    "cs_str_lower",
    "cs_str_trim",
    "cs_str_trim_start",
    "cs_str_trim_end",
  ]) {
    mod.declareExtern(f, T.ptr, [T.ptr]);
  }
  mod.declareExtern("cs_str_repeat", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_char_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_slice1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_slice2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_substr", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_substring1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_substring2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_str_pad_start", T.ptr, [T.ptr, T.double, T.ptr]);
  mod.declareExtern("cs_str_pad_end", T.ptr, [T.ptr, T.double, T.ptr]);
  mod.declareExtern("cs_str_replace", T.ptr, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_str_replaceAll", T.ptr, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_str_split", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_parse_int", T.double, [T.ptr, T.double]);
  mod.declareExtern("cs_parse_float", T.double, [T.ptr]);
  mod.declareExtern("cs_str_index_of", T.double, [T.ptr, T.ptr, T.double]);
  mod.declareExtern("cs_str_last_index_of", T.double, [T.ptr, T.ptr, T.double]);
  // All three take an optional position/endPosition (double); codegen passes the arg or a default.
  for (const f of ["cs_str_includes", "cs_str_starts_with", "cs_str_ends_with"]) {
    mod.declareExtern(f, T.i32, [T.ptr, T.ptr, T.double]);
  }
  mod.declareExtern("cs_gc_init", T.void, []);
  mod.declareExtern("cs_gc_alloc", T.ptr, [T.i64]);
  // Async runtime (runtime/async.milo): fibers, promises, await, and the microtask event loop.
  mod.declareExtern("cs_fiber_spawn", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_fiber_return", T.void, [T.i64]);
  mod.declareExtern("cs_await", T.i64, [T.ptr]);
  mod.declareExtern("cs_run_event_loop", T.void, []);
  mod.declareExtern("cs_promise_resolved", T.ptr, [T.i64]); // Promise.resolve(v)
  mod.declareExtern("cs_promise_all", T.ptr, [T.ptr]); // Promise.all(arr)
  mod.declareExtern("cs_array_new", T.ptr, []);
  mod.declareExtern("cs_argv_slice2", T.ptr, []); // process.argv.slice(2)
  mod.declareExtern("cs_date_now", T.double, []); // Date.now()
  mod.declareExtern("cs_process_pid", T.double, []); // process.pid
  mod.declareExtern("cs_fs_read_file", T.ptr, [T.ptr]);
  mod.declareExtern("cs_fs_write_file", T.void, [T.ptr, T.ptr]);
  mod.declareExtern("cs_fs_append_file", T.void, [T.ptr, T.ptr]);
  mod.declareExtern("cs_fs_exists", T.i32, [T.ptr]);
  mod.declareExtern("cs_fs_unlink", T.void, [T.ptr]);
  // node:fs/promises (runtime/fs-promises.milo): the syscall runs now, the promise settles in the
  // event loop's I/O phase.
  mod.declareExtern("cs_fsp_read_file", T.ptr, [T.ptr]);
  mod.declareExtern("cs_fsp_write_file", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_fsp_append_file", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_fsp_unlink", T.ptr, [T.ptr]);
  // node:path (runtime/path.milo). join/resolve take one CsArray of strings; the rest are 1-arg.
  mod.declareExtern("cs_path_join", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_resolve", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_normalize", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_dirname", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_basename", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_extname", T.ptr, [T.ptr]);
  mod.declareExtern("cs_path_is_absolute", T.i32, [T.ptr]);
  mod.declareExtern("cs_set_timeout", T.ptr, [T.ptr, T.double]); // setTimeout → Timeout handle
  mod.declareExtern("cs_clear_timeout", T.void, [T.ptr]);
  // JSON.parse (runtime/json-parse.milo): text → tagged tree, walked by codegen against the target.
  mod.declareExtern("cs_json_parse", T.ptr, [T.ptr]);
  mod.declareExtern("cs_json_kind", T.i32, [T.ptr]);
  mod.declareExtern("cs_json_number_of", T.double, [T.ptr]);
  mod.declareExtern("cs_json_bool_of", T.i32, [T.ptr]);
  mod.declareExtern("cs_json_string_of", T.ptr, [T.ptr]);
  mod.declareExtern("cs_json_array_len", T.i32, [T.ptr]);
  mod.declareExtern("cs_json_array_get", T.ptr, [T.ptr, T.i32]);
  mod.declareExtern("cs_json_field", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_json_expect_fail", T.void, [T.ptr, T.ptr]);
  mod.declareExtern("cs_json_object", T.ptr, [T.ptr, T.ptr, T.ptr, T.ptr, T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_inspect_key", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_push", T.i32, [T.ptr, T.i64]);
  mod.declareExtern("cs_array_len", T.i32, [T.ptr]);
  mod.declareExtern("cs_array_get", T.i64, [T.ptr, T.i32]);
  mod.declareExtern("cs_array_pop", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_shift", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_reverse", T.ptr, [T.ptr]);
  mod.declareExtern("cs_array_slice1", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_array_slice2", T.ptr, [T.ptr, T.double, T.double]);
  mod.declareExtern("cs_array_concat", T.ptr, [T.ptr, T.ptr]);
  mod.declareExtern("cs_array_set", T.void, [T.ptr, T.i32, T.i64]);
  mod.declareExtern("cs_array_extend", T.void, [T.ptr, T.ptr]);
  mod.declareExtern("cs_array_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_array_flat", T.ptr, [T.ptr]);
  mod.declareExtern("cs_str_at", T.ptr, [T.ptr, T.double]);
  mod.declareExtern("cs_str_cmp", T.i32, [T.ptr, T.ptr]);
  // Map: keys/values cross as i64 slots; `kind` (i32) selects key equality.
  mod.declareExtern("cs_map_new", T.ptr, []);
  mod.declareExtern("cs_map_set", T.void, [T.ptr, T.i64, T.i64, T.i32]);
  mod.declareExtern("cs_map_get", T.ptr, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_has", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_delete", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_map_size", T.i32, [T.ptr]);
  mod.declareExtern("cs_map_keys", T.ptr, [T.ptr]);
  mod.declareExtern("cs_map_values", T.ptr, [T.ptr]);
  mod.declareExtern("cs_set_new", T.ptr, []);
  mod.declareExtern("cs_set_from_array", T.ptr, [T.ptr, T.i32]);
  mod.declareExtern("cs_set_add", T.void, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_has", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_delete", T.i32, [T.ptr, T.i64, T.i32]);
  mod.declareExtern("cs_set_size", T.i32, [T.ptr]);
  mod.declareExtern("cs_set_values", T.ptr, [T.ptr]);
  mod.declareExtern("cs_map_clear", T.void, [T.ptr]);
  mod.declareExtern("cs_set_clear", T.void, [T.ptr]);
  // Live Map/Set iteration (runtime/ordered.milo): start → record; next(table, &rec, &pos) → the
  // next live entry's position or -1; key_at / val_at read that entry's slot.
  mod.declareExtern("cs_ord_iter_start", T.ptr, [T.ptr]);
  mod.declareExtern("cs_ord_iter_next", T.i32, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_ord_key_at", T.i64, [T.ptr, T.i32]);
  mod.declareExtern("cs_ord_val_at", T.i64, [T.ptr, T.i32]);
  mod.declareExtern("exit", T.void, [T.i32]);
  mod.declareExtern("cs_throw", T.void, [T.ptr]);
  mod.declareExtern("cs_handler_alloc", T.ptr, []);
  mod.declareExtern("cs_push_handler", T.void, [T.ptr]);
  mod.declareExtern("cs_pop_handler", T.void, []);
  mod.declareExtern("_setjmp", T.i32, [T.ptr], "returns_twice");
  mod.declareExtern("cs_handler_thrown", T.ptr, [T.ptr]);
  mod.declareExtern("cs_handler_count", T.i32, []);
  mod.declareExtern("cs_handler_restore", T.void, [T.i32]);
  mod.declareExtern("cs_new_error", T.ptr, [T.ptr]);
  mod.declareExtern("cs_new_thrown_str", T.ptr, [T.ptr]);
  mod.declareExtern("cs_thrown_is_error", T.i32, [T.ptr]);
  mod.declareExtern("cs_thrown_to_string", T.ptr, [T.ptr]);
  // Object shapes (runtime/shape.milo): inline-cache misses and shape-driven helpers.
  mod.declareExtern("cs_ic_get", T.i64, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_ic_set", T.void, [T.ptr, T.ptr, T.ptr, T.i64]);
  mod.declareExtern("cs_ic_method", T.void, [T.ptr, T.ptr, T.ptr]);
  mod.declareExtern("cs_obj_keys", T.ptr, [T.ptr]);
  mod.declareExtern("cs_obj_clone", T.ptr, [T.ptr]);
  mod.declareExtern("cs_shape_mismatch", T.void, []);
  mod.declareExtern("cs_shape_unsupported", T.void, [T.ptr]);
  mod.declareExtern("cs_json_indent", T.ptr, [T.ptr, T.i32]);
}

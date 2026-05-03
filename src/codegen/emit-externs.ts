import { EmitContext } from "./emit-context.js";

function dcl(ctx: EmitContext, name: string, ret: string, params: string[]): void {
  const m = ctx.m;
  const fnType = m.functionType(ret, params);
  const fn = m.addFunction(name, fnType);
  ctx.declareFunction(name, fn, fnType);
}

export function declareExterns(ctx: EmitContext): void {
  const m = ctx.m;

  const putsType = m.functionType(m.i32, [m.ptr]);
  const putsFn = m.addFunction("puts", putsType);
  ctx.declareFunction("puts", putsFn, putsType);

  const printfType = m.functionType(m.i32, [m.ptr], true);
  const printfFn = m.addFunction("printf", printfType);
  ctx.declareFunction("printf", printfFn, printfType);

  const sprintfType = m.functionType(m.i32, [m.ptr, m.ptr], true);
  const sprintfFn = m.addFunction("sprintf", sprintfType);
  ctx.declareFunction("sprintf", sprintfFn, sprintfType);

  const exitType = m.functionType(m.voidTy, [m.i32]);
  const exitFn = m.addFunction("exit", exitType);
  ctx.declareFunction("exit", exitFn, exitType);

  const strlenType = m.functionType(m.i64, [m.ptr]);
  const strlenFn = m.addFunction("strlen", strlenType);
  ctx.declareFunction("strlen", strlenFn, strlenType);

  const mallocType = m.functionType(m.ptr, [m.i64]);
  const mallocFn = m.addFunction("GC_malloc", mallocType);
  ctx.declareFunction("malloc", mallocFn, mallocType);

  const mallocAtomicFn = m.addFunction("GC_malloc_atomic", mallocType);
  ctx.declareFunction("malloc_atomic", mallocAtomicFn, mallocType);

  const strcpyType = m.functionType(m.ptr, [m.ptr, m.ptr]);
  const strcpyFn = m.addFunction("strcpy", strcpyType);
  ctx.declareFunction("strcpy", strcpyFn, strcpyType);

  const strcatType = m.functionType(m.ptr, [m.ptr, m.ptr]);
  const strcatFn = m.addFunction("strcat", strcatType);
  ctx.declareFunction("strcat", strcatFn, strcatType);

  const strcmpType = m.functionType(m.i32, [m.ptr, m.ptr]);
  const strcmpFn = m.addFunction("strcmp", strcmpType);
  ctx.declareFunction("strcmp", strcmpFn, strcmpType);

  const printNumType = m.functionType(m.voidTy, [m.f64]);
  const printNumFn = m.addFunction("cs2_print_number", printNumType);
  ctx.declareFunction("cs2_print_number", printNumFn, printNumType);

  const fmtNumType = m.functionType(m.voidTy, [m.ptr, m.f64]);
  const fmtNumFn = m.addFunction("cs2_format_number", fmtNumType);
  ctx.declareFunction("cs2_format_number", fmtNumFn, fmtNumType);

  const arenaAllocType = m.functionType(m.ptr, [m.i64]);
  const arenaAllocFn = m.addFunction("cs2_arena_alloc", arenaAllocType);
  ctx.declareFunction("cs2_arena_alloc", arenaAllocFn, arenaAllocType);

  const arenaResetType = m.functionType(m.voidTy, []);
  const arenaResetFn = m.addFunction("cs2_arena_reset", arenaResetType);
  ctx.declareFunction("cs2_arena_reset", arenaResetFn, arenaResetType);

  const mathIntrinsics1: [string, string][] = [
    ["llvm.floor.f64", "cs_math_floor"],
    ["llvm.ceil.f64", "cs_math_ceil"],
    ["llvm.fabs.f64", "cs_math_abs"],
    ["llvm.sqrt.f64", "cs_math_sqrt"],
    ["llvm.log.f64", "cs_math_log"],
    ["llvm.round.f64", "cs_math_round"],
    ["llvm.sin.f64", "cs_math_sin"],
    ["llvm.cos.f64", "cs_math_cos"],
    ["llvm.exp.f64", "cs_math_exp"],
    ["llvm.log2.f64", "cs_math_log2"],
    ["llvm.log10.f64", "cs_math_log10"],
    ["llvm.trunc.f64", "cs_math_trunc"],
  ];
  const math1Type = m.functionType(m.f64, [m.f64]);
  for (const [llvmName, csName] of mathIntrinsics1) {
    const fn = m.addFunction(llvmName, math1Type);
    ctx.declareMathIntrinsic(csName, fn, math1Type);
  }

  const libm1: [string, string][] = [
    ["tan", "cs_math_tan"],
    ["asin", "cs_math_asin"],
    ["acos", "cs_math_acos"],
    ["atan", "cs_math_atan"],
    ["cbrt", "cs_math_cbrt"],
  ];
  for (const [libName, csName] of libm1) {
    const fn = m.addFunction(libName, math1Type);
    ctx.declareMathIntrinsic(csName, fn, math1Type);
  }

  const mathIntrinsics2: [string, string][] = [
    ["llvm.pow.f64", "cs_math_pow"],
    ["llvm.maxnum.f64", "cs_math_max"],
    ["llvm.minnum.f64", "cs_math_min"],
  ];
  const math2Type = m.functionType(m.f64, [m.f64, m.f64]);
  for (const [llvmName, csName] of mathIntrinsics2) {
    const fn = m.addFunction(llvmName, math2Type);
    ctx.declareMathIntrinsic(csName, fn, math2Type);
  }

  const libm2: [string, string][] = [
    ["atan2", "cs_math_atan2"],
    ["hypot", "cs_math_hypot"],
  ];
  for (const [libName, csName] of libm2) {
    const fn = m.addFunction(libName, math2Type);
    ctx.declareMathIntrinsic(csName, fn, math2Type);
  }

  const ctlzType = m.functionType(m.i32, [m.i32, m.i1]);
  const ctlzFn = m.addFunction("llvm.ctlz.i32", ctlzType);
  ctx.declareMathIntrinsic("cs_math_clz32_intrinsic", ctlzFn, ctlzType);

  const setjmpType = m.functionType(m.i32, [m.ptr]);
  const setjmpFn = m.addFunction("_setjmp", setjmpType);
  ctx.declareFunction("_setjmp", setjmpFn, setjmpType);

    dcl(ctx, "cs2_str_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_char_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_index_of", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_includes", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_starts_with", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_ends_with", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_slice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_str_substring", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_str_to_upper", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_to_lower", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_trim", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_repeat", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_replace", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_char_code_at", m.i32, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_from_char_code", m.ptr, [m.i32]);
    dcl(ctx, "cs2_str_split", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_pad_start", m.ptr, [m.ptr, m.i32, m.ptr]);
    dcl(ctx, "cs2_str_pad_end", m.ptr, [m.ptr, m.i32, m.ptr]);
    dcl(ctx, "cs2_str_trim_start", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_trim_end", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_last_index_of", m.f64, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_replace_all", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_string_builder_init", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_string_builder_append", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_parse_float", m.f64, [m.ptr]);
    dcl(ctx, "cs2_parse_int", m.f64, [m.ptr]);
    dcl(ctx, "cs2_number_to_string", m.ptr, [m.f64]);
    dcl(ctx, "cs2_number_to_fixed", m.ptr, [m.f64, m.f64]);
    dcl(ctx, "cs2_number_is_integer", m.i32, [m.f64]);
    dcl(ctx, "cs2_number_is_nan", m.i32, [m.f64]);
    dcl(ctx, "cs2_number_is_finite", m.i32, [m.f64]);
    dcl(ctx, "cs2_date_now", m.f64, []);
    dcl(ctx, "cs2_date_new", m.ptr, [m.f64]);
    dcl(ctx, "cs2_date_new_now", m.ptr, []);
    dcl(ctx, "cs2_date_get_time", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_full_year", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_month", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_date", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_hours", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_minutes", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_seconds", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_day", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_to_iso_string", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_date_to_string", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_date_get_milliseconds", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_get_timezone_offset", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_value_of", m.f64, [m.ptr]);
    dcl(ctx, "cs2_date_set_time", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_full_year", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_month", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_date", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_hours", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_minutes", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_set_seconds", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_date_to_date_string", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_date_to_time_string", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_os_hostname", m.ptr, []);
    dcl(ctx, "cs2_os_homedir", m.ptr, []);
    dcl(ctx, "cs2_os_tmpdir", m.ptr, []);
    dcl(ctx, "cs2_os_platform", m.ptr, []);
    dcl(ctx, "cs2_os_arch", m.ptr, []);
    dcl(ctx, "cs2_os_type", m.ptr, []);
    dcl(ctx, "cs2_os_uptime", m.f64, []);
    dcl(ctx, "cs2_math_random", m.f64, []);
    dcl(ctx, "cs2_num_array_new", m.ptr, [m.i32]);
    dcl(ctx, "cs2_num_array_push", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_array_pop", m.f64, [m.ptr]);
    dcl(ctx, "cs2_num_array_get", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_array_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_array_fill", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_array_sort_fn", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_set", m.voidTy, [m.ptr, m.i32, m.f64]);
    dcl(ctx, "cs2_num_array_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_num_array_index_of", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_array_includes", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_array_slice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_num_array_reverse", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_array_sort", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_array_shift", m.f64, [m.ptr]);
    dcl(ctx, "cs2_num_array_unshift", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_array_splice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_num_array_concat", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_find", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_every", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_some", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_reduce", m.f64, [m.ptr, m.ptr, m.ptr, m.f64]);
    dcl(ctx, "cs2_print_num_array", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_array_join", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_num_array_spread", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_new", m.ptr, [m.i32]);
    dcl(ctx, "cs2_str_array_push", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_pop", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_array_get", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_array_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]);
    dcl(ctx, "cs2_str_array_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_array_index_of", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_includes", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_slice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_str_array_reverse", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_array_concat", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_shift", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_array_unshift", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_every", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_some", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_find", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_reduce", m.ptr, [m.ptr, m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_sort", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_array_fill", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_splice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_print_str_array", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_array_join", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_array_spread", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_new", m.ptr, [m.i32]);
    dcl(ctx, "cs2_obj_array_push", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_pop", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_obj_array_get", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_obj_array_set", m.voidTy, [m.ptr, m.i32, m.ptr]);
    dcl(ctx, "cs2_obj_array_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_obj_array_map", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_flatMap", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_filter", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_find", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_every", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_some", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_spread", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_unshift", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_join", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_obj_array_slice", m.ptr, [m.ptr, m.i32, m.i32]);
    dcl(ctx, "cs2_try_enter", m.ptr, []);
    dcl(ctx, "cs2_try_leave", m.voidTy, []);
    dcl(ctx, "cs2_throw", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_catch_msg", m.ptr, []);
    dcl(ctx, "nanbox_from_f64", m.i64, [m.f64]);
    dcl(ctx, "nanbox_from_i64", m.i64, [m.i64]);
    dcl(ctx, "nanbox_from_bool", m.i64, [m.i32]);
    dcl(ctx, "nanbox_from_string", m.i64, [m.ptr]);
    dcl(ctx, "nanbox_from_ptr", m.i64, [m.ptr]);
    dcl(ctx, "nanbox_to_f64", m.f64, [m.i64]);
    dcl(ctx, "nanbox_to_i64", m.i64, [m.i64]);
    dcl(ctx, "nanbox_to_bool", m.i32, [m.i64]);
    dcl(ctx, "nanbox_to_string", m.ptr, [m.i64]);
    dcl(ctx, "cs2_boxed_to_string", m.ptr, [m.i64]);
    dcl(ctx, "nanbox_to_ptr", m.ptr, [m.i64]);
    dcl(ctx, "nanbox_is_number", m.i32, [m.i64]);
    dcl(ctx, "nanbox_is_string", m.i32, [m.i64]);
    dcl(ctx, "nanbox_is_bool", m.i32, [m.i64]);
    dcl(ctx, "nanbox_is_null", m.i32, [m.i64]);
    dcl(ctx, "nanbox_is_undefined", m.i32, [m.i64]);
    dcl(ctx, "nanbox_is_ptr", m.i32, [m.i64]);
    dcl(ctx, "nanbox_typeof", m.ptr, [m.i64]);
    dcl(ctx, "nanbox_truthy", m.i32, [m.i64]);
    dcl(ctx, "nanbox_add", m.i64, [m.i64, m.i64]);
    dcl(ctx, "nanbox_sub", m.i64, [m.i64, m.i64]);
    dcl(ctx, "nanbox_mul", m.i64, [m.i64, m.i64]);
    dcl(ctx, "nanbox_div", m.i64, [m.i64, m.i64]);
    dcl(ctx, "nanbox_rem", m.i64, [m.i64, m.i64]);
    dcl(ctx, "nanbox_neg", m.i64, [m.i64]);
    dcl(ctx, "nanbox_eq", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_ne", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_lt", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_le", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_gt", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_ge", m.i32, [m.i64, m.i64]);
    dcl(ctx, "nanbox_to_string_val", m.i64, [m.i64]);
    dcl(ctx, "nanbox_print", m.voidTy, [m.i64]);
    dcl(ctx, "nanbox_undefined", m.i64, []);
    dcl(ctx, "nanbox_null", m.i64, []);
    dcl(ctx, "cs2_promise_new", m.ptr, []);
    dcl(ctx, "cs2_promise_resolve_f64", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_promise_resolve_i64", m.voidTy, [m.ptr, m.i64]);
    dcl(ctx, "cs2_promise_resolve_bool", m.voidTy, [m.ptr, m.i32]);
    dcl(ctx, "cs2_promise_resolve_ptr", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_promise_resolve_str", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_promise_resolve_void", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_promise_get_f64", m.f64, [m.ptr]);
    dcl(ctx, "cs2_promise_get_i64", m.i64, [m.ptr]);
    dcl(ctx, "cs2_promise_get_bool", m.i32, [m.ptr]);
    dcl(ctx, "cs2_promise_get_ptr", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_promise_get_str", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_promise_all_num", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_promise_all_str", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_promise_race_num", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_promise_race_str", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_set_timeout", m.ptr, [m.ptr, m.f64]);
    dcl(ctx, "cs2_set_interval", m.ptr, [m.ptr, m.f64]);
    dcl(ctx, "cs2_clear_timer", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_run_event_loop", m.i32, []);
    dcl(ctx, "cs2_json_stringify_f64", m.ptr, [m.f64]);
    dcl(ctx, "cs2_json_stringify_i64", m.ptr, [m.i64]);
    dcl(ctx, "cs2_json_stringify_str", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_stringify_bool", m.ptr, [m.i32]);
    dcl(ctx, "cs2_json_stringify_null", m.ptr, []);
    dcl(ctx, "cs2_json_stringify_boxed", m.ptr, [m.i64]);
    dcl(ctx, "cs2_json_stringify_num_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_stringify_str_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_stringify_dynobj", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_stringify_dynarray", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_stringify_obj_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_parse", m.i64, [m.ptr]);
    dcl(ctx, "cs2_process_init", m.voidTy, [m.i32, m.ptr]);
    dcl(ctx, "cs2_process_argv_array", m.ptr, []);
    dcl(ctx, "cs2_process_env_get", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_process_cwd", m.ptr, []);
    dcl(ctx, "cs2_process_platform", m.ptr, []);
    dcl(ctx, "cs2_process_exit", m.voidTy, [m.i32]);
    dcl(ctx, "cs2_console_time", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_console_time_end", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_stderr_str", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_stderr_str_nl", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_stderr_number", m.voidTy, [m.f64]);
    dcl(ctx, "cs2_stderr_i64", m.voidTy, [m.i64]);
    dcl(ctx, "cs2_stderr_bool", m.voidTy, [m.i32]);
    dcl(ctx, "cs2_stderr_nl", m.voidTy, []);
    dcl(ctx, "cs2_stderr_space", m.voidTy, []);
    dcl(ctx, "cs2_stderr_boxed", m.voidTy, [m.i64]);
    dcl(ctx, "cs2_path_join", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_path_resolve", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_path_dirname", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_path_basename", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_path_extname", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_fs_read_file_sync", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_fs_write_file_sync", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_fs_exists_sync", m.i32, [m.ptr]);
    dcl(ctx, "cs2_fs_readdir_sync", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_fs_mkdir_sync", m.i32, [m.ptr]);
    dcl(ctx, "cs2_fs_unlink_sync", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_fs_stat_is_file", m.i32, [m.ptr]);
    dcl(ctx, "cs2_fs_stat_is_directory", m.i32, [m.ptr]);
    dcl(ctx, "cs2_exec_sync", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_crypto_random_bytes_hex", m.ptr, [m.f64]);
    dcl(ctx, "cs2_crypto_hash", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_buffer_from_string", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_buffer_alloc", m.ptr, [m.f64]);
    dcl(ctx, "cs2_buffer_to_string", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_buffer_length", m.f64, [m.ptr]);
    dcl(ctx, "cs2_buffer_at", m.f64, [m.ptr, m.f64]);
    dcl(ctx, "cs2_uint8array_new", m.ptr, [m.f64]);
    dcl(ctx, "cs2_uint8array_get", m.f64, [m.ptr, m.f64]);
    dcl(ctx, "cs2_uint8array_set", m.voidTy, [m.ptr, m.f64, m.f64]);
    dcl(ctx, "cs2_uint8array_length", m.f64, [m.ptr]);
    dcl(ctx, "cs2_uint8array_from_num_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_float64array_new", m.ptr, [m.f64]);
    dcl(ctx, "cs2_float64array_get", m.f64, [m.ptr, m.f64]);
    dcl(ctx, "cs2_float64array_set", m.voidTy, [m.ptr, m.f64, m.f64]);
    dcl(ctx, "cs2_float64array_length", m.f64, [m.ptr]);
    dcl(ctx, "cs2_float64array_from_num_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_new", m.ptr, []);
    dcl(ctx, "cs2_str_num_map_set", m.voidTy, [m.ptr, m.ptr, m.f64]);
    dcl(ctx, "cs2_str_num_map_get", m.f64, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_num_map_has", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_num_map_delete", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_num_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_keys", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_copy", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_num_map_key_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_num_map_value_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_str_map_new", m.ptr, []);
    dcl(ctx, "cs2_str_str_map_set", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_str_map_get", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_str_map_has", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_str_map_delete", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_str_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_str_map_keys", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_str_map_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_str_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_str_map_copy", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_str_map_key_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_str_map_value_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_num_map_new", m.ptr, []);
    dcl(ctx, "cs2_num_num_map_set", m.voidTy, [m.ptr, m.f64, m.f64]);
    dcl(ctx, "cs2_num_num_map_get", m.f64, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_num_map_has", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_num_map_delete", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_num_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_num_num_map_keys", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_num_map_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_num_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_num_map_copy", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_num_map_key_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_num_map_value_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_str_map_new", m.ptr, []);
    dcl(ctx, "cs2_num_str_map_set", m.voidTy, [m.ptr, m.f64, m.ptr]);
    dcl(ctx, "cs2_num_str_map_get", m.ptr, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_str_map_has", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_str_map_delete", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_str_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_num_str_map_keys", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_str_map_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_str_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_str_map_copy", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_str_map_key_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_str_map_value_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_ptr_map_new", m.ptr, []);
    dcl(ctx, "cs2_str_ptr_map_set", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_get", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_has", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_delete", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_str_ptr_map_key_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_str_ptr_map_value_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_ptr_map_new", m.ptr, []);
    dcl(ctx, "cs2_num_ptr_map_set", m.voidTy, [m.ptr, m.f64, m.ptr]);
    dcl(ctx, "cs2_num_ptr_map_get", m.ptr, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_ptr_map_has", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_ptr_map_delete", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_ptr_map_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_num_ptr_map_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_ptr_map_key_at", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_ptr_map_value_at", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_num_ptr_map_copy", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_ptr_map_keys", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_set_new", m.ptr, []);
    dcl(ctx, "cs2_str_set_add", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_set_has", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_set_delete", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_str_set_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_str_set_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_str_set_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_num_set_new", m.ptr, []);
    dcl(ctx, "cs2_num_set_add", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_set_has", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_set_delete", m.i32, [m.ptr, m.f64]);
    dcl(ctx, "cs2_num_set_size", m.i32, [m.ptr]);
    dcl(ctx, "cs2_num_set_values", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_num_set_clear", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_regex_new", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_regex_test", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_regex_exec_match", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_string_match", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_string_replace_regex", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_http_create_server", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_http_server_listen", m.voidTy, [m.ptr, m.f64, m.ptr]);
    dcl(ctx, "cs2_http_server_close", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_http_res_write_head", m.voidTy, [m.ptr, m.f64, m.ptr]);
    dcl(ctx, "cs2_http_res_end", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_http_req_method", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_http_req_url", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_fetch_sync", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_dynobj_new", m.ptr, []);
    dcl(ctx, "cs2_dynobj_set_f64", m.voidTy, [m.ptr, m.ptr, m.f64]);
    dcl(ctx, "cs2_dynobj_set_str", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_set_bool", m.voidTy, [m.ptr, m.ptr, m.i32]);
    dcl(ctx, "cs2_dynobj_set_null", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_set_obj", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_set_arr", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_set_boxed", m.voidTy, [m.ptr, m.ptr, m.i64]);
    dcl(ctx, "cs2_dynobj_get_f64", m.f64, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_get_str", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_get_bool", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_get_obj", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_get_arr", m.ptr, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_get_boxed", m.i64, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_has", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_delete", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_tag", m.i32, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynobj_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_dynarray_new", m.ptr, []);
    dcl(ctx, "cs2_dynarray_from_obj_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_dynarray_from_str_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_dynarray_from_num_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_dynarray_from_boxed_array", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_obj_array_from_dynarray", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_dynarray_push_f64", m.voidTy, [m.ptr, m.f64]);
    dcl(ctx, "cs2_dynarray_push_str", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_push_obj", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_push_arr", m.voidTy, [m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_push_null", m.voidTy, [m.ptr]);
    dcl(ctx, "cs2_dynarray_push_bool", m.voidTy, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_length", m.i32, [m.ptr]);
    dcl(ctx, "cs2_dynarray_tag_at", m.i32, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_f64", m.f64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_str", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_obj", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_arr", m.ptr, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_bool", m.i32, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_get_boxed", m.i64, [m.ptr, m.i32]);
    dcl(ctx, "cs2_dynarray_push_boxed", m.voidTy, [m.ptr, m.i64]);
    dcl(ctx, "cs2_dynarray_filter", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_map", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_forEach", m.voidTy, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_find", m.i64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_findIndex", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_every", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_some", m.f64, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_dynarray_flatMap", m.ptr, [m.ptr, m.ptr, m.ptr]);
    dcl(ctx, "cs2_json_parse_obj", m.ptr, [m.ptr]);
    dcl(ctx, "cs2_json_parse_arr", m.ptr, [m.ptr]);
}

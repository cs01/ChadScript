import { MethodCallNode, VariableNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";
import { emitAdd, emitSelect, emitPhi } from "../infrastructure/ir-builders.js";

/**
 * Path Method Generator
 *
 * Generates LLVM IR for path.* methods using POSIX path functions.
 *
 * Supported methods:
 * - path.resolve(path) → realpath() syscall
 * - path.dirname(path) → dirname() function
 */
export class PathGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a path.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "path") return false;
    const supported = ["resolve", "dirname", "basename", "join", "extname", "isAbsolute"];
    return supported.indexOf(expr.method) !== -1;
  }

  /**
   * Generate LLVM IR for path.resolve(path)
   * Uses realpath() POSIX function to resolve path
   */
  generateResolve(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.resolve() requires at least 1 argument", expr.loc);
    }

    let pathPtr = this.ctx.generateExpression(expr.args[0], params);

    if (expr.args.length > 1) {
      const slash = this.ctx.stringGen.doCreateStringConstant("/");
      for (let i = 1; i < expr.args.length; i++) {
        const part = this.ctx.generateExpression(expr.args[i], params);
        const withSlash = this.ctx.stringGen.doGenerateStringConcatDirect(pathPtr, slash);
        pathPtr = this.ctx.stringGen.doGenerateStringConcatDirect(withSlash, part);
      }
    }

    const bufferSize = emitAdd(this.ctx, "i64", "0", "4096");
    const buffer = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${bufferSize}`);

    const resolvedPtr = this.ctx.emitCall("i8*", "@realpath", `i8* ${pathPtr}, i8* ${buffer}`);

    const isNull = this.ctx.emitIcmp("eq", "i8*", resolvedPtr, "null");

    const successLabel = this.ctx.nextLabel("resolve_success");
    const failLabel = this.ctx.nextLabel("resolve_fail");
    const endLabel = this.ctx.nextLabel("resolve_end");

    this.ctx.emitBrCond(isNull, failLabel, successLabel);

    this.ctx.emitLabel(successLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(failLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = emitPhi(this.ctx, "i8*", [
      [resolvedPtr, successLabel],
      [pathPtr, failLabel],
    ]);

    return result;
  }

  /**
   * Generate LLVM IR for path.dirname(path)
   * Uses dirname() POSIX function
   */
  generateDirname(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.dirname() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // dirname() modifies its argument, so we need to make a copy
    const pathLen = this.ctx.emitCall("i64", "@strlen", `i8* ${pathPtr}`);
    const copySize = emitAdd(this.ctx, "i64", pathLen, "1");
    const pathCopy = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${copySize}`);
    const copyResult = this.ctx.emitCall("i8*", "@strcpy", `i8* ${pathCopy}, i8* ${pathPtr}`);

    const result = this.ctx.emitCall("i8*", "@dirname", `i8* ${pathCopy}`);

    return result;
  }

  generateBasename(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.basename() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const pathLen = this.ctx.emitCall("i64", "@strlen", `i8* ${pathPtr}`);
    const copySize = emitAdd(this.ctx, "i64", pathLen, "1");
    const pathCopy = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${copySize}`);
    const copyResult = this.ctx.emitCall("i8*", "@strcpy", `i8* ${pathCopy}, i8* ${pathPtr}`);

    const basenamePtr = this.ctx.emitCall("i8*", "@basename", `i8* ${pathCopy}`);

    const resultLen = this.ctx.emitCall("i64", "@strlen", `i8* ${basenamePtr}`);
    const resultSize = emitAdd(this.ctx, "i64", resultLen, "1");
    const result = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${resultSize}`);
    const strdupResult = this.ctx.emitCall("i8*", "@strcpy", `i8* ${result}, i8* ${basenamePtr}`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generateJoin(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.join() requires at least 1 argument", expr.loc);
    }

    let result = this.ctx.generateExpression(expr.args[0], params);
    const slash = this.ctx.stringGen.doCreateStringConstant("/");

    for (let i = 1; i < expr.args.length; i++) {
      const part = this.ctx.generateExpression(expr.args[i], params);
      const withSlash = this.ctx.stringGen.doGenerateStringConcatDirect(result, slash);
      result = this.ctx.stringGen.doGenerateStringConcatDirect(withSlash, part);
    }

    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateExtname(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.extname() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const dotPtr = this.ctx.emitCall("i8*", "@strrchr", `i8* ${pathPtr}, i32 46`);

    const isNull = this.ctx.emitIcmp("eq", "i8*", dotPtr, "null");

    const hasDotLabel = this.ctx.nextLabel("extname_has_dot");
    const noDotLabel = this.ctx.nextLabel("extname_no_dot");
    const endLabel = this.ctx.nextLabel("extname_end");

    this.ctx.emitBrCond(isNull, noDotLabel, hasDotLabel);

    this.ctx.emitLabel(noDotLabel);
    const emptyStr = this.ctx.createStringConstant("");
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(hasDotLabel);
    const extDup = this.ctx.emitCall("i8*", "@strdup", `i8* ${dotPtr}`);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    return emitPhi(this.ctx, "i8*", [
      [emptyStr, noDotLabel],
      [extDup, hasDotLabel],
    ]);
  }

  generateNormalize(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.normalize() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.emitCall("i8*", "@__path_normalize", `i8* ${pathPtr}`);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateIsAbsolute(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.isAbsolute() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // inbounds GEP — keep as raw emit
    const firstCharPtr = this.ctx.nextTemp();
    this.ctx.emit(`${firstCharPtr} = getelementptr inbounds i8, i8* ${pathPtr}, i64 0`);
    const firstChar = this.ctx.emitLoad("i8", firstCharPtr);
    const isSlash = this.ctx.emitIcmp("eq", "i8", firstChar, "47");
    return emitSelect(this.ctx, isSlash, "double", "1.0", "0.0");
  }

  generateParse(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.parse() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.emitCall("i8*", "@__path_parse", `i8* ${pathPtr}`);
    this.ctx.setVariableType(result, "%PathParseResult*");
    return result;
  }

  generateRelative(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("path.relative() requires 2 arguments", expr.loc);
    }

    const fromPtr = this.ctx.generateExpression(expr.args[0], params);
    const toPtr = this.ctx.generateExpression(expr.args[1], params);
    const result = this.ctx.emitCall("i8*", "@__path_relative", `i8* ${fromPtr}, i8* ${toPtr}`);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateRelativeHelper(): string {
    let ir = "";
    ir +=
      "; path.relative(from, to) — normalize both, find common prefix, build ../.. + remainder\n";
    ir += "define i8* @__path_relative(i8* %from, i8* %to) {\n";
    ir += "entry:\n";
    ir += "  %nfrom = call i8* @__path_normalize(i8* %from)\n";
    ir += "  %nto = call i8* @__path_normalize(i8* %to)\n";
    ir += "  %from_len = call i64 @strlen(i8* %nfrom)\n";
    ir += "  %to_len = call i64 @strlen(i8* %nto)\n";

    // Check if both are identical
    ir += "  %cmp_eq = call i32 @strcmp(i8* %nfrom, i8* %nto)\n";
    ir += "  %is_same = icmp eq i32 %cmp_eq, 0\n";
    ir += "  br i1 %is_same, label %return_dot, label %find_common\n\n";

    ir += "return_dot:\n";
    ir += "  %dot = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 46, i8* %dot\n";
    ir += "  %dot1 = getelementptr inbounds i8, i8* %dot, i64 1\n";
    ir += "  store i8 0, i8* %dot1\n";
    ir += "  ret i8* %dot\n\n";

    // Find common prefix length at '/' boundaries
    ir += "find_common:\n";
    ir += "  br label %prefix_loop\n\n";

    ir += "prefix_loop:\n";
    ir += "  %pi = phi i64 [ 0, %find_common ], [ %pi_next, %prefix_cont ]\n";
    ir += "  %last_sep = phi i64 [ 0, %find_common ], [ %new_last_sep, %prefix_cont ]\n";
    ir += "  %from_done = icmp uge i64 %pi, %from_len\n";
    ir += "  %to_done = icmp uge i64 %pi, %to_len\n";
    ir += "  %either_done = or i1 %from_done, %to_done\n";
    ir += "  br i1 %either_done, label %prefix_end, label %prefix_cmp\n\n";

    ir += "prefix_cmp:\n";
    ir += "  %from_cp = getelementptr inbounds i8, i8* %nfrom, i64 %pi\n";
    ir += "  %to_cp = getelementptr inbounds i8, i8* %nto, i64 %pi\n";
    ir += "  %fc = load i8, i8* %from_cp\n";
    ir += "  %tc = load i8, i8* %to_cp\n";
    ir += "  %chars_eq = icmp eq i8 %fc, %tc\n";
    ir += "  br i1 %chars_eq, label %prefix_match, label %prefix_end\n\n";

    // Matched char — update last_sep if it's a slash or if we're at position 0
    ir += "prefix_match:\n";
    ir += "  %is_sep_char = icmp eq i8 %fc, 47\n";
    ir += "  %pi_plus1 = add i64 %pi, 1\n";
    ir += "  %new_last_sep = select i1 %is_sep_char, i64 %pi_plus1, i64 %last_sep\n";
    ir += "  br label %prefix_cont\n\n";

    ir += "prefix_cont:\n";
    ir += "  %pi_next = add i64 %pi, 1\n";
    ir += "  br label %prefix_loop\n\n";

    // We know the common prefix ends; check if we exhausted one of them at a boundary
    ir += "prefix_end:\n";
    ir += "  %common_at_pi = phi i64 [ %pi, %prefix_loop ], [ %pi, %prefix_cmp ]\n";
    ir += "  %sep_at_pi = phi i64 [ %last_sep, %prefix_loop ], [ %last_sep, %prefix_cmp ]\n";
    // If pi == from_len, the 'from' is fully consumed — common = from_len
    // If pi == to_len, the 'to' is fully consumed — common = to_len
    // Otherwise, common = last_sep (the position right after the last slash)
    ir += "  %from_fully = icmp eq i64 %common_at_pi, %from_len\n";
    ir += "  br i1 %from_fully, label %check_to_fully, label %use_last_sep\n\n";

    ir += "check_to_fully:\n";
    ir += "  %to_fully = icmp eq i64 %common_at_pi, %to_len\n";
    // If both fully consumed, we already handled the equal case above
    // If from is fully consumed, check if to[pi] is '/'
    ir += "  br i1 %to_fully, label %use_pi, label %check_to_sep\n\n";

    ir += "check_to_sep:\n";
    ir += "  %to_at_pi = getelementptr inbounds i8, i8* %nto, i64 %common_at_pi\n";
    ir += "  %to_ch = load i8, i8* %to_at_pi\n";
    ir += "  %to_is_sep = icmp eq i8 %to_ch, 47\n";
    ir += "  br i1 %to_is_sep, label %use_pi, label %use_last_sep\n\n";

    ir += "use_pi:\n";
    ir += "  br label %got_common\n\n";

    ir += "use_last_sep:\n";
    // Also check: if to is done, is from[pi] a slash?
    ir += "  %to_fully2 = icmp eq i64 %common_at_pi, %to_len\n";
    ir += "  br i1 %to_fully2, label %check_from_sep, label %use_sep_val\n\n";

    ir += "check_from_sep:\n";
    ir += "  %from_at_pi = getelementptr inbounds i8, i8* %nfrom, i64 %common_at_pi\n";
    ir += "  %from_ch = load i8, i8* %from_at_pi\n";
    ir += "  %from_is_sep = icmp eq i8 %from_ch, 47\n";
    ir += "  br i1 %from_is_sep, label %use_pi2, label %use_sep_val\n\n";

    ir += "use_pi2:\n";
    ir += "  br label %got_common\n\n";

    ir += "use_sep_val:\n";
    ir += "  br label %got_common\n\n";

    ir += "got_common:\n";
    ir +=
      "  %common = phi i64 [ %common_at_pi, %use_pi ], [ %common_at_pi, %use_pi2 ], [ %sep_at_pi, %use_sep_val ]\n";

    // Count remaining components in 'from' after common prefix
    // Skip leading slash if present
    ir += "  %from_rest_start_raw = add i64 %common, 0\n";
    ir += "  %from_rest_check = icmp ult i64 %from_rest_start_raw, %from_len\n";
    ir += "  br i1 %from_rest_check, label %skip_from_sep, label %count_done_zero\n\n";

    ir += "skip_from_sep:\n";
    ir += "  %from_rest_ch_ptr = getelementptr inbounds i8, i8* %nfrom, i64 %from_rest_start_raw\n";
    ir += "  %from_rest_ch = load i8, i8* %from_rest_ch_ptr\n";
    ir += "  %from_rest_is_sep = icmp eq i8 %from_rest_ch, 47\n";
    ir += "  %from_rest_skip = select i1 %from_rest_is_sep, i64 1, i64 0\n";
    ir += "  %from_rest_start = add i64 %from_rest_start_raw, %from_rest_skip\n";
    ir += "  %from_rest_empty = icmp uge i64 %from_rest_start, %from_len\n";
    ir += "  br i1 %from_rest_empty, label %count_done_zero, label %count_loop\n\n";

    ir += "count_done_zero:\n";
    ir += "  br label %build_result\n\n";

    // Count slashes in from[from_rest_start..from_len] → ups = slashes + 1
    ir += "count_loop:\n";
    ir += "  %ci = phi i64 [ %from_rest_start, %skip_from_sep ], [ %ci_next, %count_cont ]\n";
    ir += "  %ups = phi i64 [ 1, %skip_from_sep ], [ %new_ups, %count_cont ]\n";
    ir += "  %ci_done = icmp uge i64 %ci, %from_len\n";
    ir += "  br i1 %ci_done, label %count_done, label %count_check\n\n";

    ir += "count_check:\n";
    ir += "  %ci_ptr = getelementptr inbounds i8, i8* %nfrom, i64 %ci\n";
    ir += "  %ci_ch = load i8, i8* %ci_ptr\n";
    ir += "  %ci_is_sep = icmp eq i8 %ci_ch, 47\n";
    ir += "  %ci_inc = select i1 %ci_is_sep, i64 1, i64 0\n";
    ir += "  %new_ups = add i64 %ups, %ci_inc\n";
    ir += "  br label %count_cont\n\n";

    ir += "count_cont:\n";
    ir += "  %ci_next = add i64 %ci, 1\n";
    ir += "  br label %count_loop\n\n";

    ir += "count_done:\n";
    ir += "  br label %build_result\n\n";

    // Build result: ups * "../" (3 bytes each, minus trailing slash) + to_rest
    ir += "build_result:\n";
    ir += "  %up_count = phi i64 [ 0, %count_done_zero ], [ %ups, %count_done ]\n";
    // Get the 'to' remainder
    ir += "  %to_rest_raw = add i64 %common, 0\n";
    ir += "  %to_rest_check = icmp ult i64 %to_rest_raw, %to_len\n";
    ir += "  br i1 %to_rest_check, label %skip_to_sep, label %to_rest_ready\n\n";

    ir += "skip_to_sep:\n";
    ir += "  %to_rest_ptr = getelementptr inbounds i8, i8* %nto, i64 %to_rest_raw\n";
    ir += "  %to_rest_fc = load i8, i8* %to_rest_ptr\n";
    ir += "  %to_rest_is_sep = icmp eq i8 %to_rest_fc, 47\n";
    ir += "  %to_skip = select i1 %to_rest_is_sep, i64 1, i64 0\n";
    ir += "  %to_rest_start = add i64 %to_rest_raw, %to_skip\n";
    ir += "  br label %to_rest_ready\n\n";

    ir += "to_rest_ready:\n";
    ir += "  %to_rest_off = phi i64 [ %to_len, %build_result ], [ %to_rest_start, %skip_to_sep ]\n";
    ir += "  %to_rest_len = sub i64 %to_len, %to_rest_off\n";

    // Total size: up_count * 3 (for "../") - 1 (no trailing slash on last ..) + to_rest_len + possible slash between + null
    // But if up_count == 0 and to_rest_len == 0 → return "."
    // If up_count > 0: up_count * 3 - 1 bytes for the "../.." part
    // If to_rest_len > 0 and up_count > 0: need a "/" separator
    ir += "  %has_ups = icmp ugt i64 %up_count, 0\n";
    ir += "  %has_rest = icmp ugt i64 %to_rest_len, 0\n";
    ir += "  %has_either = or i1 %has_ups, %has_rest\n";
    ir += "  br i1 %has_either, label %calc_size, label %return_dot2\n\n";

    ir += "return_dot2:\n";
    ir += "  %dot2 = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 46, i8* %dot2\n";
    ir += "  %dot2_end = getelementptr inbounds i8, i8* %dot2, i64 1\n";
    ir += "  store i8 0, i8* %dot2_end\n";
    ir += "  ret i8* %dot2\n\n";

    ir += "calc_size:\n";
    // ups part: up_count * 3 - 1 (if up_count > 0), else 0
    ir += "  %ups_times3 = mul i64 %up_count, 3\n";
    ir += "  %ups_bytes_raw = sub i64 %ups_times3, 1\n";
    ir += "  %ups_bytes = select i1 %has_ups, i64 %ups_bytes_raw, i64 0\n";
    // separator between ups and rest: 1 if both present
    ir += "  %need_mid_sep = and i1 %has_ups, %has_rest\n";
    ir += "  %mid_sep = select i1 %need_mid_sep, i64 1, i64 0\n";
    ir += "  %total_no_null = add i64 %ups_bytes, %mid_sep\n";
    ir += "  %total_no_null2 = add i64 %total_no_null, %to_rest_len\n";
    ir += "  %total = add i64 %total_no_null2, 1\n";
    ir += "  %result_buf = call i8* @cs_arena_alloc(i64 %total)\n";

    // Write the "../.." part
    ir += "  br i1 %has_ups, label %write_ups, label %write_rest_check\n\n";

    ir += "write_ups:\n";
    ir += "  br label %ups_loop\n\n";

    ir += "ups_loop:\n";
    ir += "  %ui = phi i64 [ 0, %write_ups ], [ %ui_next, %ups_sep ]\n";
    ir += "  %wi = phi i64 [ 0, %write_ups ], [ %wi_after_sep, %ups_sep ]\n";
    ir += "  %ui_done = icmp uge i64 %ui, %up_count\n";
    ir += "  br i1 %ui_done, label %ups_done, label %write_dotdot\n\n";

    ir += "write_dotdot:\n";
    ir += "  %dd_ptr0 = getelementptr inbounds i8, i8* %result_buf, i64 %wi\n";
    ir += "  store i8 46, i8* %dd_ptr0\n";
    ir += "  %wi1 = add i64 %wi, 1\n";
    ir += "  %dd_ptr1 = getelementptr inbounds i8, i8* %result_buf, i64 %wi1\n";
    ir += "  store i8 46, i8* %dd_ptr1\n";
    ir += "  %wi2 = add i64 %wi, 2\n";
    ir += "  %ui_next = add i64 %ui, 1\n";
    // Write "/" separator between ".." components (not after last one)
    ir += "  %not_last = icmp ult i64 %ui_next, %up_count\n";
    ir += "  br i1 %not_last, label %ups_sep, label %ups_done2\n\n";

    ir += "ups_sep:\n";
    ir += "  %sep_ptr = getelementptr inbounds i8, i8* %result_buf, i64 %wi2\n";
    ir += "  store i8 47, i8* %sep_ptr\n";
    ir += "  %wi_after_sep = add i64 %wi2, 1\n";
    ir += "  br label %ups_loop\n\n";

    ir += "ups_done:\n";
    ir += "  br label %write_rest_check\n\n";

    ir += "ups_done2:\n";
    ir += "  br label %write_rest_check\n\n";

    ir += "write_rest_check:\n";
    ir += "  %dst_pos = phi i64 [ 0, %calc_size ], [ %wi, %ups_done ], [ %wi2, %ups_done2 ]\n";
    ir += "  br i1 %has_rest, label %write_mid_sep_check, label %null_term\n\n";

    ir += "write_mid_sep_check:\n";
    ir += "  br i1 %has_ups, label %write_mid_sep, label %write_rest\n\n";

    ir += "write_mid_sep:\n";
    ir += "  %mid_ptr = getelementptr inbounds i8, i8* %result_buf, i64 %dst_pos\n";
    ir += "  store i8 47, i8* %mid_ptr\n";
    ir += "  %dst_after_mid = add i64 %dst_pos, 1\n";
    ir += "  br label %write_rest\n\n";

    ir += "write_rest:\n";
    ir +=
      "  %rest_dst = phi i64 [ %dst_pos, %write_mid_sep_check ], [ %dst_after_mid, %write_mid_sep ]\n";
    ir += "  %rest_src = getelementptr inbounds i8, i8* %nto, i64 %to_rest_off\n";
    ir += "  %rest_dst_ptr = getelementptr inbounds i8, i8* %result_buf, i64 %rest_dst\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %rest_dst_ptr, i8* %rest_src, i64 %to_rest_len, i1 false)\n";
    ir += "  %dst_after_rest = add i64 %rest_dst, %to_rest_len\n";
    ir += "  br label %null_term\n\n";

    ir += "null_term:\n";
    ir +=
      "  %final_pos = phi i64 [ %dst_pos, %write_rest_check ], [ %dst_after_rest, %write_rest ]\n";
    ir += "  %term_ptr = getelementptr inbounds i8, i8* %result_buf, i64 %final_pos\n";
    ir += "  store i8 0, i8* %term_ptr\n";
    ir += "  ret i8* %result_buf\n";
    ir += "}\n\n";
    return ir;
  }

  generateNormalizeHelper(): string {
    let ir = "";
    ir += "define i8* @__path_normalize(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %len = call i64 @strlen(i8* %path)\n";
    ir += "  %is_empty = icmp eq i64 %len, 0\n";
    ir += "  br i1 %is_empty, label %return_dot, label %start\n\n";

    ir += "return_dot:\n";
    ir += "  %dot = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 46, i8* %dot\n";
    ir += "  %dot1 = getelementptr inbounds i8, i8* %dot, i64 1\n";
    ir += "  store i8 0, i8* %dot1\n";
    ir += "  ret i8* %dot\n\n";

    ir += "start:\n";
    ir += "  %buf_size = add i64 %len, 2\n";
    ir += "  %buf = call i8* @cs_arena_alloc(i64 %buf_size)\n";
    ir += "  %first_char = load i8, i8* %path\n";
    ir += "  %is_abs = icmp eq i8 %first_char, 47\n";
    ir += "  %init_dst = select i1 %is_abs, i64 1, i64 0\n";
    ir += "  br i1 %is_abs, label %write_slash, label %scan_init\n\n";

    ir += "write_slash:\n";
    ir += "  store i8 47, i8* %buf\n";
    ir += "  br label %scan_init\n\n";

    ir += "scan_init:\n";
    ir += "  br label %skip_slashes\n\n";

    ir += "skip_slashes:\n";
    ir +=
      "  %src0 = phi i64 [ 0, %scan_init ], [ %src_next, %skip_slashes_cont ], [ %src_end, %do_copy ], [ %src_end2, %handle_dot ], [ %src_end3, %dotdot_done ]\n";
    ir +=
      "  %dst0 = phi i64 [ %init_dst, %scan_init ], [ %dst0, %skip_slashes_cont ], [ %dst_after_copy, %do_copy ], [ %dst0, %handle_dot ], [ %dst_after_dotdot, %dotdot_done ]\n";
    ir += "  %c_skip = getelementptr inbounds i8, i8* %path, i64 %src0\n";
    ir += "  %ch_skip = load i8, i8* %c_skip\n";
    ir += "  %is_slash_skip = icmp eq i8 %ch_skip, 47\n";
    ir += "  br i1 %is_slash_skip, label %skip_slashes_cont, label %check_end\n\n";

    ir += "skip_slashes_cont:\n";
    ir += "  %src_next = add i64 %src0, 1\n";
    ir += "  br label %skip_slashes\n\n";

    ir += "check_end:\n";
    ir += "  %is_done = icmp eq i8 %ch_skip, 0\n";
    ir += "  br i1 %is_done, label %finish, label %find_component_end\n\n";

    ir += "find_component_end:\n";
    ir += "  %comp_start = add i64 %src0, 0\n";
    ir += "  br label %scan_comp\n\n";

    ir += "scan_comp:\n";
    ir +=
      "  %src1 = phi i64 [ %comp_start, %find_component_end ], [ %src1_next, %scan_comp_cont ]\n";
    ir += "  %c_comp = getelementptr inbounds i8, i8* %path, i64 %src1\n";
    ir += "  %ch_comp = load i8, i8* %c_comp\n";
    ir += "  %is_end = icmp eq i8 %ch_comp, 0\n";
    ir += "  %is_sep = icmp eq i8 %ch_comp, 47\n";
    ir += "  %stop = or i1 %is_end, %is_sep\n";
    ir += "  br i1 %stop, label %got_component, label %scan_comp_cont\n\n";

    ir += "scan_comp_cont:\n";
    ir += "  %src1_next = add i64 %src1, 1\n";
    ir += "  br label %scan_comp\n\n";

    ir += "got_component:\n";
    ir += "  %comp_len = sub i64 %src1, %comp_start\n";
    ir += "  %is_dot_len = icmp eq i64 %comp_len, 1\n";
    ir += "  br i1 %is_dot_len, label %check_single_dot, label %check_dotdot_len\n\n";

    ir += "check_single_dot:\n";
    ir += "  %dot_ptr = getelementptr inbounds i8, i8* %path, i64 %comp_start\n";
    ir += "  %dot_ch = load i8, i8* %dot_ptr\n";
    ir += "  %is_dot = icmp eq i8 %dot_ch, 46\n";
    ir += "  br i1 %is_dot, label %handle_dot, label %copy_component\n\n";

    ir += "handle_dot:\n";
    ir += "  %src_end2 = add i64 %src1, 0\n";
    ir += "  br label %skip_slashes\n\n";

    ir += "check_dotdot_len:\n";
    ir += "  %is_dotdot_len = icmp eq i64 %comp_len, 2\n";
    ir += "  br i1 %is_dotdot_len, label %check_dotdot_chars, label %copy_component\n\n";

    ir += "check_dotdot_chars:\n";
    ir += "  %dd_ptr0 = getelementptr inbounds i8, i8* %path, i64 %comp_start\n";
    ir += "  %dd_ch0 = load i8, i8* %dd_ptr0\n";
    ir += "  %dd_is_dot0 = icmp eq i8 %dd_ch0, 46\n";
    ir += "  %dd_off1 = add i64 %comp_start, 1\n";
    ir += "  %dd_ptr1 = getelementptr inbounds i8, i8* %path, i64 %dd_off1\n";
    ir += "  %dd_ch1 = load i8, i8* %dd_ptr1\n";
    ir += "  %dd_is_dot1 = icmp eq i8 %dd_ch1, 46\n";
    ir += "  %is_dotdot = and i1 %dd_is_dot0, %dd_is_dot1\n";
    ir += "  br i1 %is_dotdot, label %handle_dotdot, label %copy_component\n\n";

    ir += "handle_dotdot:\n";
    ir += "  %min_dst = select i1 %is_abs, i64 1, i64 0\n";
    ir += "  %can_pop = icmp ugt i64 %dst0, %min_dst\n";
    ir += "  br i1 %can_pop, label %pop_slash, label %dotdot_done\n\n";

    ir += "pop_slash:\n";
    ir += "  %dst_back0 = sub i64 %dst0, 1\n";
    ir += "  %back_ch_ptr0 = getelementptr inbounds i8, i8* %buf, i64 %dst_back0\n";
    ir += "  %back_ch0 = load i8, i8* %back_ch_ptr0\n";
    ir += "  %back_is_sep = icmp eq i8 %back_ch0, 47\n";
    ir += "  %dst_pop_start = select i1 %back_is_sep, i64 %dst_back0, i64 %dst0\n";
    ir += "  br label %pop_loop\n\n";

    ir += "pop_loop:\n";
    ir +=
      "  %dst_pop = phi i64 [ %dst_pop_start, %pop_slash ], [ %dst_pop_prev, %pop_loop_cont ]\n";
    ir += "  %pop_at_min = icmp ule i64 %dst_pop, %min_dst\n";
    ir += "  br i1 %pop_at_min, label %dotdot_done, label %pop_loop_check\n\n";

    ir += "pop_loop_check:\n";
    ir += "  %dst_pop_prev = sub i64 %dst_pop, 1\n";
    ir += "  %pop_ch_ptr = getelementptr inbounds i8, i8* %buf, i64 %dst_pop_prev\n";
    ir += "  %pop_ch = load i8, i8* %pop_ch_ptr\n";
    ir += "  %pop_is_sep = icmp eq i8 %pop_ch, 47\n";
    ir += "  br i1 %pop_is_sep, label %dotdot_done, label %pop_loop_cont\n\n";

    ir += "pop_loop_cont:\n";
    ir += "  br label %pop_loop\n\n";

    ir += "dotdot_done:\n";
    ir +=
      "  %dst_after_dotdot = phi i64 [ %dst0, %handle_dotdot ], [ %min_dst, %pop_loop ], [ %dst_pop, %pop_loop_check ]\n";
    ir += "  %src_end3 = add i64 %src1, 0\n";
    ir += "  br label %skip_slashes\n\n";

    ir += "copy_component:\n";
    ir += "  %need_sep = icmp ugt i64 %dst0, 0\n";
    ir += "  br i1 %need_sep, label %check_trailing_sep, label %do_copy\n\n";

    ir += "check_trailing_sep:\n";
    ir += "  %last_dst_idx = sub i64 %dst0, 1\n";
    ir += "  %last_dst_ptr = getelementptr inbounds i8, i8* %buf, i64 %last_dst_idx\n";
    ir += "  %last_dst_ch = load i8, i8* %last_dst_ptr\n";
    ir += "  %already_has_sep = icmp eq i8 %last_dst_ch, 47\n";
    ir += "  br i1 %already_has_sep, label %do_copy, label %add_sep\n\n";

    ir += "add_sep:\n";
    ir += "  %sep_ptr = getelementptr inbounds i8, i8* %buf, i64 %dst0\n";
    ir += "  store i8 47, i8* %sep_ptr\n";
    ir += "  %dst_after_sep = add i64 %dst0, 1\n";
    ir += "  br label %do_copy\n\n";

    ir += "do_copy:\n";
    ir +=
      "  %dst_copy = phi i64 [ %dst0, %copy_component ], [ %dst0, %check_trailing_sep ], [ %dst_after_sep, %add_sep ]\n";
    ir += "  %copy_src = getelementptr inbounds i8, i8* %path, i64 %comp_start\n";
    ir += "  %copy_dst = getelementptr inbounds i8, i8* %buf, i64 %dst_copy\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %copy_dst, i8* %copy_src, i64 %comp_len, i1 false)\n";
    ir += "  %dst_after_copy = add i64 %dst_copy, %comp_len\n";
    ir += "  %src_end = add i64 %src1, 0\n";
    ir += "  br label %skip_slashes\n\n";

    ir += "finish:\n";
    ir += "  %final_dst = phi i64 [ %dst0, %check_end ]\n";
    ir += "  %is_zero = icmp eq i64 %final_dst, 0\n";
    ir += "  br i1 %is_zero, label %return_dot2, label %null_term\n\n";

    ir += "return_dot2:\n";
    ir += "  %dot2 = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 46, i8* %dot2\n";
    ir += "  %dot2_1 = getelementptr inbounds i8, i8* %dot2, i64 1\n";
    ir += "  store i8 0, i8* %dot2_1\n";
    ir += "  ret i8* %dot2\n\n";

    ir += "null_term:\n";
    ir += "  %term_ptr = getelementptr inbounds i8, i8* %buf, i64 %final_dst\n";
    ir += "  store i8 0, i8* %term_ptr\n";
    ir += "  ret i8* %buf\n";
    ir += "}\n\n";
    return ir;
  }

  // %PathParseResult = { root, dir, base, name, ext } — all i8*
  generateParseHelper(): string {
    let ir = "";
    ir += "%PathParseResult = type { i8*, i8*, i8*, i8*, i8* }\n\n";
    ir += "define i8* @__path_parse(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %len = call i64 @strlen(i8* %path)\n";
    ir += "  %result_mem = call i8* @GC_malloc(i64 40)\n";
    ir += "  %result = bitcast i8* %result_mem to %PathParseResult*\n";

    // Find last slash position
    ir += "  %last_slash = call i8* @strrchr(i8* %path, i32 47)\n";
    ir += "  %has_slash = icmp ne i8* %last_slash, null\n";
    ir += "  br i1 %has_slash, label %with_slash, label %no_slash\n\n";

    // --- No slash: root="", dir="", base=path, name/ext from dot ---
    ir += "no_slash:\n";
    ir += "  %empty0 = call i8* @cs_arena_alloc(i64 1)\n";
    ir += "  store i8 0, i8* %empty0\n";
    ir +=
      "  %root0 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 0\n";
    ir += "  store i8* %empty0, i8** %root0\n";
    ir +=
      "  %dir0 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 1\n";
    ir += "  store i8* %empty0, i8** %dir0\n";
    // base = full path
    ir += "  %base_dup0 = call i8* @strdup(i8* %path)\n";
    ir +=
      "  %base0 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 2\n";
    ir += "  store i8* %base_dup0, i8** %base0\n";
    ir += "  br label %find_ext\n\n";

    // --- Has slash ---
    ir += "with_slash:\n";
    // root: "/" if path starts with "/"
    ir += "  %first_ch = load i8, i8* %path\n";
    ir += "  %is_abs = icmp eq i8 %first_ch, 47\n";
    ir += "  br i1 %is_abs, label %set_root_slash, label %set_root_empty\n\n";

    ir += "set_root_slash:\n";
    ir += "  %root_buf = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 47, i8* %root_buf\n";
    ir += "  %root_buf1 = getelementptr inbounds i8, i8* %root_buf, i64 1\n";
    ir += "  store i8 0, i8* %root_buf1\n";
    ir += "  br label %store_root\n\n";

    ir += "set_root_empty:\n";
    ir += "  %root_empty = call i8* @cs_arena_alloc(i64 1)\n";
    ir += "  store i8 0, i8* %root_empty\n";
    ir += "  br label %store_root\n\n";

    ir += "store_root:\n";
    ir +=
      "  %root_val = phi i8* [ %root_buf, %set_root_slash ], [ %root_empty, %set_root_empty ]\n";
    ir +=
      "  %root1 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 0\n";
    ir += "  store i8* %root_val, i8** %root1\n";

    // dir: path up to (not including) last slash
    // If last_slash == path (root slash only), dir = "/"
    ir += "  %slash_is_root = icmp eq i8* %last_slash, %path\n";
    ir += "  br i1 %slash_is_root, label %dir_is_root, label %dir_substr\n\n";

    ir += "dir_is_root:\n";
    ir += "  %dir_root = call i8* @cs_arena_alloc(i64 2)\n";
    ir += "  store i8 47, i8* %dir_root\n";
    ir += "  %dir_root1 = getelementptr inbounds i8, i8* %dir_root, i64 1\n";
    ir += "  store i8 0, i8* %dir_root1\n";
    ir += "  br label %store_dir\n\n";

    ir += "dir_substr:\n";
    ir += "  %slash_off_raw = ptrtoint i8* %last_slash to i64\n";
    ir += "  %path_off_raw = ptrtoint i8* %path to i64\n";
    ir += "  %dir_len = sub i64 %slash_off_raw, %path_off_raw\n";
    ir += "  %dir_size = add i64 %dir_len, 1\n";
    ir += "  %dir_buf = call i8* @cs_arena_alloc(i64 %dir_size)\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dir_buf, i8* %path, i64 %dir_len, i1 false)\n";
    ir += "  %dir_term = getelementptr inbounds i8, i8* %dir_buf, i64 %dir_len\n";
    ir += "  store i8 0, i8* %dir_term\n";
    ir += "  br label %store_dir\n\n";

    ir += "store_dir:\n";
    ir += "  %dir_val = phi i8* [ %dir_root, %dir_is_root ], [ %dir_buf, %dir_substr ]\n";
    ir +=
      "  %dir1 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 1\n";
    ir += "  store i8* %dir_val, i8** %dir1\n";

    // base: everything after last slash
    ir += "  %base_start = getelementptr inbounds i8, i8* %last_slash, i64 1\n";
    ir += "  %base_dup1 = call i8* @strdup(i8* %base_start)\n";
    ir +=
      "  %base1 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 2\n";
    ir += "  store i8* %base_dup1, i8** %base1\n";
    ir += "  br label %find_ext\n\n";

    // --- Find ext: last dot in base ---
    ir += "find_ext:\n";
    ir += "  %base_ptr = phi i8* [ %base_dup0, %no_slash ], [ %base_dup1, %store_dir ]\n";
    ir += "  %dot_ptr = call i8* @strrchr(i8* %base_ptr, i32 46)\n";
    ir += "  %has_dot = icmp ne i8* %dot_ptr, null\n";
    // Don't count leading dot as extension (e.g. ".gitignore" → ext="")
    ir += "  br i1 %has_dot, label %check_leading_dot, label %no_ext\n\n";

    ir += "check_leading_dot:\n";
    ir += "  %dot_is_first = icmp eq i8* %dot_ptr, %base_ptr\n";
    ir += "  br i1 %dot_is_first, label %no_ext, label %has_ext\n\n";

    // --- Has extension ---
    ir += "has_ext:\n";
    ir += "  %ext_dup = call i8* @strdup(i8* %dot_ptr)\n";
    ir +=
      "  %ext_f = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 4\n";
    ir += "  store i8* %ext_dup, i8** %ext_f\n";
    // name: base up to dot
    ir += "  %dot_off_raw = ptrtoint i8* %dot_ptr to i64\n";
    ir += "  %base_off_raw = ptrtoint i8* %base_ptr to i64\n";
    ir += "  %name_len = sub i64 %dot_off_raw, %base_off_raw\n";
    ir += "  %name_size = add i64 %name_len, 1\n";
    ir += "  %name_buf = call i8* @cs_arena_alloc(i64 %name_size)\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %name_buf, i8* %base_ptr, i64 %name_len, i1 false)\n";
    ir += "  %name_term = getelementptr inbounds i8, i8* %name_buf, i64 %name_len\n";
    ir += "  store i8 0, i8* %name_term\n";
    ir +=
      "  %name_f = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 3\n";
    ir += "  store i8* %name_buf, i8** %name_f\n";
    ir += "  br label %done\n\n";

    // --- No extension ---
    ir += "no_ext:\n";
    ir += "  %empty_ext = call i8* @cs_arena_alloc(i64 1)\n";
    ir += "  store i8 0, i8* %empty_ext\n";
    ir +=
      "  %ext_f2 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 4\n";
    ir += "  store i8* %empty_ext, i8** %ext_f2\n";
    // name = base (entire base is the name)
    ir += "  %name_dup = call i8* @strdup(i8* %base_ptr)\n";
    ir +=
      "  %name_f2 = getelementptr inbounds %PathParseResult, %PathParseResult* %result, i32 0, i32 3\n";
    ir += "  store i8* %name_dup, i8** %name_f2\n";
    ir += "  br label %done\n\n";

    ir += "done:\n";
    ir += "  ret i8* %result_mem\n";
    ir += "}\n\n";
    return ir;
  }
}

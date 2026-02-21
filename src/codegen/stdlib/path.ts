import { MethodCallNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

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
    const varNode = expr.object as { type: string; name: string };
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

    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 0, 4096`);
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    const resolvedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resolvedPtr} = call i8* @realpath(i8* ${pathPtr}, i8* ${buffer})`);

    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${resolvedPtr}, null`);

    const successLabel = this.ctx.nextLabel("resolve_success");
    const failLabel = this.ctx.nextLabel("resolve_fail");
    const endLabel = this.ctx.nextLabel("resolve_end");

    this.ctx.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

    this.ctx.emit(`${successLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${failLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ ${resolvedPtr}, %${successLabel} ], [ ${pathPtr}, %${failLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");

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
    const pathLen = this.ctx.nextTemp();
    this.ctx.emit(`${pathLen} = call i64 @strlen(i8* ${pathPtr})`);
    const copySize = this.ctx.nextTemp();
    this.ctx.emit(`${copySize} = add i64 ${pathLen}, 1`);
    const pathCopy = this.ctx.nextTemp();
    this.ctx.emit(`${pathCopy} = call i8* @GC_malloc_atomic(i64 ${copySize})`);
    const copyResult = this.ctx.nextTemp();
    this.ctx.emit(`${copyResult} = call i8* @strcpy(i8* ${pathCopy}, i8* ${pathPtr})`);

    // Call dirname: dirname(pathCopy)
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @dirname(i8* ${pathCopy})`);

    return result;
  }

  generateBasename(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.basename() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const pathLen = this.ctx.nextTemp();
    this.ctx.emit(`${pathLen} = call i64 @strlen(i8* ${pathPtr})`);
    const copySize = this.ctx.nextTemp();
    this.ctx.emit(`${copySize} = add i64 ${pathLen}, 1`);
    const pathCopy = this.ctx.nextTemp();
    this.ctx.emit(`${pathCopy} = call i8* @GC_malloc_atomic(i64 ${copySize})`);
    const copyResult = this.ctx.nextTemp();
    this.ctx.emit(`${copyResult} = call i8* @strcpy(i8* ${pathCopy}, i8* ${pathPtr})`);

    const basenamePtr = this.ctx.nextTemp();
    this.ctx.emit(`${basenamePtr} = call i8* @basename(i8* ${pathCopy})`);

    const resultLen = this.ctx.nextTemp();
    this.ctx.emit(`${resultLen} = call i64 @strlen(i8* ${basenamePtr})`);
    const resultSize = this.ctx.nextTemp();
    this.ctx.emit(`${resultSize} = add i64 ${resultLen}, 1`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @GC_malloc_atomic(i64 ${resultSize})`);
    const strdupResult = this.ctx.nextTemp();
    this.ctx.emit(`${strdupResult} = call i8* @strcpy(i8* ${result}, i8* ${basenamePtr})`);
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

    const dotPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dotPtr} = call i8* @strrchr(i8* ${pathPtr}, i32 46)`);

    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${dotPtr}, null`);

    const hasDotLabel = this.ctx.nextLabel("extname_has_dot");
    const noDotLabel = this.ctx.nextLabel("extname_no_dot");
    const endLabel = this.ctx.nextLabel("extname_end");

    this.ctx.emit(`br i1 ${isNull}, label %${noDotLabel}, label %${hasDotLabel}`);

    this.ctx.emit(`${noDotLabel}:`);
    const emptyStr = this.ctx.createStringConstant("");
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${hasDotLabel}:`);
    const extDup = this.ctx.nextTemp();
    this.ctx.emit(`${extDup} = call i8* @strdup(i8* ${dotPtr})`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ ${emptyStr}, %${noDotLabel} ], [ ${extDup}, %${hasDotLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateNormalize(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.normalize() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__path_normalize(i8* ${pathPtr})`);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateIsAbsolute(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("path.isAbsolute() requires 1 argument", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const firstCharPtr = this.ctx.nextTemp();
    this.ctx.emit(`${firstCharPtr} = getelementptr inbounds i8, i8* ${pathPtr}, i64 0`);
    const firstChar = this.ctx.nextTemp();
    this.ctx.emit(`${firstChar} = load i8, i8* ${firstCharPtr}`);
    const isSlash = this.ctx.nextTemp();
    this.ctx.emit(`${isSlash} = icmp eq i8 ${firstChar}, 47`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = select i1 ${isSlash}, double 1.0, double 0.0`);
    return result;
  }

  generateNormalizeHelper(): string {
    let ir = "";
    ir += "define i8* @__path_normalize(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %len = call i64 @strlen(i8* %path)\n";
    ir += "  %is_empty = icmp eq i64 %len, 0\n";
    ir += "  br i1 %is_empty, label %return_dot, label %start\n\n";

    ir += "return_dot:\n";
    ir += "  %dot = call i8* @GC_malloc_atomic(i64 2)\n";
    ir += "  store i8 46, i8* %dot\n";
    ir += "  %dot1 = getelementptr inbounds i8, i8* %dot, i64 1\n";
    ir += "  store i8 0, i8* %dot1\n";
    ir += "  ret i8* %dot\n\n";

    ir += "start:\n";
    ir += "  %buf_size = add i64 %len, 2\n";
    ir += "  %buf = call i8* @GC_malloc_atomic(i64 %buf_size)\n";
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
    ir += "  %dot2 = call i8* @GC_malloc_atomic(i64 2)\n";
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
}

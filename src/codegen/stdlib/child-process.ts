// child-process.ts — Codegen for child_process sync and async operations.
// Sync: cs_execSync/cs_spawnSync via child-process-bridge.c
// Async: child_process.exec() returns Promise<SpawnSyncResult> via uv_queue_work

import { MethodCallNode, CallNode } from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";

interface ExprBase {
  type: string;
}

export class ChildProcessGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== "child_process" && varNode.name !== "cp") return false;
    const supported = ["execSync", "spawnSync", "exec"];
    return supported.indexOf(expr.method) !== -1;
  }

  /**
   * child_process.execSync(command) → i8* (stdout string, trailing newline stripped)
   * Calls cs_execSync which crashes on non-zero exit.
   */
  generateExecSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("execSync() requires 1 argument (command)", expr.loc);
    }
    this.ctx.setUsesChildProcess(true);
    const cmdPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.emitCall("i8*", "@cs_execSync", `i8* ${cmdPtr}`);
    return result;
  }

  /**
   * Bare execSync(command) → i8* (same as child_process.execSync)
   * Used by calls.ts for top-level execSync() calls.
   */
  generateBareExecSync(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("execSync() requires 1 argument (command)", expr.loc);
    }
    this.ctx.setUsesChildProcess(true);
    const cmdPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.emitCall("i8*", "@cs_execSync", `i8* ${cmdPtr}`);
    return result;
  }

  /**
   * child_process.spawnSync(command, args?) → %SpawnSyncResult*
   * When called with just a command string: shell mode (runs through /bin/sh -c)
   * When called with command + string[] args: direct execvp mode
   */
  generateSpawnSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("spawnSync() requires at least 1 argument (command)", expr.loc);
    }
    this.ctx.setUsesChildProcess(true);
    const cmdPtr = this.ctx.generateExpression(expr.args[0], params);

    let argsDataPtr: string;
    let argsLen: string;

    if (expr.args.length >= 2) {
      // Has args array — extract i8** data ptr and i32 length from %StringArray*
      const argsArray = this.ctx.generateExpression(expr.args[1], params);
      // GEP to get data pointer (field 0 of %StringArray)
      const dataPtrPtr = this.ctx.emitGep("%StringArray", argsArray, "i32 0, i32 0");
      argsDataPtr = this.ctx.emitLoad("i8**", dataPtrPtr);
      // GEP to get length (field 1 of %StringArray)
      const lenPtr = this.ctx.emitGep("%StringArray", argsArray, "i32 0, i32 1");
      argsLen = this.ctx.emitLoad("i32", lenPtr);
    } else {
      // No args — pass null and 0 for shell mode
      argsDataPtr = "null";
      argsLen = "0";
    }

    const result = this.ctx.emitCall(
      "i8*",
      "@cs_spawnSync",
      `i8* ${cmdPtr}, i8** ${argsDataPtr}, i32 ${argsLen}`,
    );

    // The C bridge returns SpawnSyncResult* as i8*, bitcast to typed pointer
    const typed = this.ctx.emitBitcast(result, "i8*", "%SpawnSyncResult*");
    this.ctx.setVariableType(typed, "%SpawnSyncResult*");
    return typed;
  }

  /**
   * child_process.exec(command) → Promise<SpawnSyncResult>
   * Runs command in a thread pool via uv_queue_work, resolves with result struct.
   */
  generateExec(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("exec() requires 1 argument (command)", expr.loc);
    }
    this.ctx.setUsesChildProcess(true);
    this.ctx.setUsesPromises(true);
    this.ctx.setUsesAsyncFs(true); // reuses FsWorkContext + __fs_after_work_cb
    const cmdPtr = this.ctx.generateExpression(expr.args[0], params);
    const result = this.ctx.emitCall("%Promise*", "@__cp_exec_async", `i8* ${cmdPtr}`);
    this.ctx.setVariableType(result, "%Promise*");
    return result;
  }
}

/**
 * Generates LLVM IR helper functions for async child_process operations.
 * Reuses %FsWorkContext and @__fs_after_work_cb from async-fs — the context struct
 * stores {command, unused, result_ptr, promise} which maps to the same layout.
 *
 * The work callback runs cs_spawnSync in the thread pool. The after-work callback
 * (shared with async fs) resolves the promise with the result pointer.
 */
export class AsyncChildProcessGenerator {
  generateAll(): string {
    let ir = "\n; --- Async child_process helpers ---\n";
    ir += this.generateExecWorkCb();
    ir += this.generateExecAsync();
    return ir;
  }

  // Thread pool callback: runs cs_spawnSync(cmd, null, 0) and stores result
  private generateExecWorkCb(): string {
    let ir = "";
    ir += "define void @__cp_exec_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += "  %req_i8 = bitcast %struct.uv_work_s* %req to i8*\n";
    ir += "  %data = call i8* @uv_req_get_data(i8* %req_i8)\n";
    ir += "  %ctx = bitcast i8* %data to %FsWorkContext*\n";
    ir +=
      "  %cmd_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  %cmd = load i8*, i8** %cmd_ptr\n";
    // cs_spawnSync with null args and argc=0 runs in shell mode (/bin/sh -c)
    ir += "  %result = call i8* @cs_spawnSync(i8* %cmd, i8** null, i32 0)\n";
    ir +=
      "  %result_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  store i8* %result, i8** %result_ptr\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  // Entry point: creates promise, queues work, returns promise
  private generateExecAsync(): string {
    let ir = "";
    ir += "define %Promise* @__cp_exec_async(i8* %cmd) {\n";
    ir += "entry:\n";
    ir += "  %promise = call %Promise* @__Promise_new()\n";
    ir += "  %ctx_mem = call i8* @GC_malloc(i64 32)\n";
    ir += "  %ctx = bitcast i8* %ctx_mem to %FsWorkContext*\n";
    // Store command in field 0
    ir +=
      "  %cmd_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  store i8* %cmd, i8** %cmd_ptr\n";
    // Field 1 (arg2) unused, store null
    ir +=
      "  %arg2_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 1\n";
    ir += "  store i8* null, i8** %arg2_ptr\n";
    // Field 2 (result) init to null
    ir +=
      "  %result_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  store i8* null, i8** %result_ptr\n";
    // Field 3 (promise)
    ir +=
      "  %promise_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 3\n";
    ir += "  store %Promise* %promise, %Promise** %promise_ptr\n";
    // Create uv_work_t request
    ir += "  %req_mem = call i8* @GC_malloc(i64 128)\n";
    ir += "  %req = bitcast i8* %req_mem to %struct.uv_work_s*\n";
    ir += "  call void @uv_req_set_data(i8* %req_mem, i8* %ctx_mem)\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir +=
      "  call i32 @uv_queue_work(%struct.uv_loop_s* %loop, %struct.uv_work_s* %req, void (%struct.uv_work_s*)* @__cp_exec_work_cb, void (%struct.uv_work_s*, i32)* @__fs_after_work_cb)\n";
    ir += "  ret %Promise* %promise\n";
    ir += "}\n\n";
    return ir;
  }
}

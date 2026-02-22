// child-process.ts — Codegen for child_process.execSync and child_process.spawnSync.
// Delegates to C bridge functions cs_execSync/cs_spawnSync in child-process-bridge.c.

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
    const supported = ["execSync", "spawnSync"];
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
}

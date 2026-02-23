import { MethodCallNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

/**
 * Filesystem Method Generator
 *
 * Generates LLVM IR for fs.* methods using POSIX file I/O functions.
 *
 * Supported methods:
 * - fs.readFileSync(filename) → fopen + fread + fclose
 * - fs.writeFileSync(filename, data) → fopen + fwrite + fclose
 * - fs.existsSync(filename) → fopen + fclose (check NULL)
 * - fs.unlinkSync(filename) → unlink syscall
 */
export class FilesystemGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a fs.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== "fs") return false;
    const supported = [
      "readFileSync",
      "writeFileSync",
      "appendFileSync",
      "existsSync",
      "unlinkSync",
      "readdirSync",
      "statSync",
      "mkdirSync",
      "renameSync",
      "copyFileSync",
    ];
    return supported.indexOf(expr.method) !== -1;
  }

  /**
   * Generate LLVM IR for fs.readFileSync(filename)
   * Reads entire file into a string
   */
  generateReadFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "fs.readFileSync() requires at least 1 argument (filename)",
        expr.loc,
      );
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Create "r" mode string for fopen
    const modeStr = this.ctx.createStringConstant("r");

    // Open file: FILE* fp = fopen(filename, "r")
    const filePtr = this.ctx.emitCall("i8*", "@fopen", `i8* ${filenamePtr}, i8* ${modeStr}`);

    // Check if file opened successfully
    const isNull = this.ctx.emitIcmp("eq", "i8*", filePtr, "null");

    const failLabel = this.ctx.nextLabel("read_fail");
    const successLabel = this.ctx.nextLabel("read_success");
    const endLabel = this.ctx.nextLabel("read_end");

    this.ctx.emitBrCond(isNull, failLabel, successLabel);

    // Failure case: return empty string
    this.ctx.emitLabel(failLabel);
    const emptyStr = this.ctx.createStringConstant("");
    this.ctx.emitBr(endLabel);

    // Success case: read file
    this.ctx.emitLabel(successLabel);

    // Seek to end to get file size: fseek(fp, 0, SEEK_END)
    const seekEnd = this.ctx.emitCall("i32", "@fseek", `i8* ${filePtr}, i64 0, i32 2`);

    // Get file size: size = ftell(fp)
    const fileSize = this.ctx.emitCall("i64", "@ftell", `i8* ${filePtr}`);

    // Seek back to beginning: fseek(fp, 0, SEEK_SET)
    const seekStart = this.ctx.emitCall("i32", "@fseek", `i8* ${filePtr}, i64 0, i32 0`);

    // Allocate buffer: GC_malloc_atomic(size + 1) for null terminator
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 ${fileSize}, 1`);
    const buffer = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${bufferSize}`);

    // Read file: fread(buffer, 1, size, fp)
    const bytesRead = this.ctx.emitCall(
      "i64",
      "@fread",
      `i8* ${buffer}, i64 1, i64 ${fileSize}, i8* ${filePtr}`,
    );

    // Null-terminate the string (inbounds GEP — keep as raw emit)
    const nullPos = this.ctx.nextTemp();
    this.ctx.emit(`${nullPos} = getelementptr inbounds i8, i8* ${buffer}, i64 ${fileSize}`);
    this.ctx.emitStore("i8", "0", nullPos);

    // Close file: fclose(fp)
    const closeResult = this.ctx.emitCall("i32", "@fclose", `i8* ${filePtr}`);

    this.ctx.emitBr(endLabel);

    // End: phi node to select result
    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ ${emptyStr}, %${failLabel} ], [ ${buffer}, %${successLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  /**
   * Generate LLVM IR for fs.writeFileSync(filename, data)
   * Writes data to file, overwriting if it exists
   */
  generateWriteFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError(
        "fs.writeFileSync() requires at least 2 arguments (filename, data)",
        expr.loc,
      );
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);
    const dataPtr = this.ctx.generateExpression(expr.args[1], params);

    // Create "w" mode string for fopen
    const modeStr = this.ctx.createStringConstant("w");

    // Open file: FILE* fp = fopen(filename, "w")
    const filePtr = this.ctx.emitCall("i8*", "@fopen", `i8* ${filenamePtr}, i8* ${modeStr}`);

    // Check if file opened successfully
    const isNull = this.ctx.emitIcmp("eq", "i8*", filePtr, "null");

    const failLabel = this.ctx.nextLabel("write_fail");
    const successLabel = this.ctx.nextLabel("write_success");
    const endLabel = this.ctx.nextLabel("write_end");

    this.ctx.emitBrCond(isNull, failLabel, successLabel);

    // Failure case: return -1
    this.ctx.emitLabel(failLabel);
    this.ctx.emitBr(endLabel);

    // Success case: write file
    this.ctx.emitLabel(successLabel);

    // Get data length: strlen(data)
    const dataLen = this.ctx.emitCall("i64", "@strlen", `i8* ${dataPtr}`);

    // Write data: fwrite(data, 1, len, fp)
    const bytesWritten = this.ctx.emitCall(
      "i64",
      "@fwrite",
      `i8* ${dataPtr}, i64 1, i64 ${dataLen}, i8* ${filePtr}`,
    );

    // Close file: fclose(fp)
    const closeResult = this.ctx.emitCall("i32", "@fclose", `i8* ${filePtr}`);

    this.ctx.emitBr(endLabel);

    // End: phi node to return success/failure
    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ -1, %${failLabel} ], [ 0, %${successLabel} ]`);

    return result;
  }

  generateAppendFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError(
        "fs.appendFileSync() requires at least 2 arguments (filename, data)",
        expr.loc,
      );
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);
    const dataPtr = this.ctx.generateExpression(expr.args[1], params);

    const modeStr = this.ctx.createStringConstant("a");

    const filePtr = this.ctx.emitCall("i8*", "@fopen", `i8* ${filenamePtr}, i8* ${modeStr}`);

    const isNull = this.ctx.emitIcmp("eq", "i8*", filePtr, "null");

    const failLabel = this.ctx.nextLabel("append_fail");
    const successLabel = this.ctx.nextLabel("append_success");
    const endLabel = this.ctx.nextLabel("append_end");

    this.ctx.emitBrCond(isNull, failLabel, successLabel);

    this.ctx.emitLabel(failLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(successLabel);

    const dataLen = this.ctx.emitCall("i64", "@strlen", `i8* ${dataPtr}`);

    const bytesWritten = this.ctx.emitCall(
      "i64",
      "@fwrite",
      `i8* ${dataPtr}, i64 1, i64 ${dataLen}, i8* ${filePtr}`,
    );

    const closeResult = this.ctx.emitCall("i32", "@fclose", `i8* ${filePtr}`);

    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ -1, %${failLabel} ], [ 0, %${successLabel} ]`);

    return result;
  }

  /**
   * Generate LLVM IR for fs.existsSync(filename)
   * Returns 1 if file exists, 0 otherwise
   */
  generateExistsSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fs.existsSync() requires 1 argument (filename)", expr.loc);
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Try to open file in read mode
    const modeStr = this.ctx.createStringConstant("r");
    const filePtr = this.ctx.emitCall("i8*", "@fopen", `i8* ${filenamePtr}, i8* ${modeStr}`);

    // Check if file opened successfully (NULL means doesn't exist)
    const isNull = this.ctx.emitIcmp("eq", "i8*", filePtr, "null");

    const existsLabel = this.ctx.nextLabel("exists");
    const notExistsLabel = this.ctx.nextLabel("not_exists");
    const endLabel = this.ctx.nextLabel("exists_end");

    this.ctx.emitBrCond(isNull, notExistsLabel, existsLabel);

    // File exists: close it and return 1
    this.ctx.emitLabel(existsLabel);
    const closeResult = this.ctx.emitCall("i32", "@fclose", `i8* ${filePtr}`);
    this.ctx.emitBr(endLabel);

    // File doesn't exist: return 0
    this.ctx.emitLabel(notExistsLabel);
    this.ctx.emitBr(endLabel);

    // End: phi node to return 1 (exists) or 0 (doesn't exist)
    this.ctx.emitLabel(endLabel);
    const phiResult = this.ctx.nextTemp();
    this.ctx.emit(`${phiResult} = phi i32 [ 1, %${existsLabel} ], [ 0, %${notExistsLabel} ]`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = sitofp i32 ${phiResult} to double`);

    return result;
  }

  /**
   * Generate LLVM IR for fs.unlinkSync(filename)
   * Deletes file, returns 0 on success or -1 on error
   */
  generateUnlinkSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fs.unlinkSync() requires 1 argument (filename)", expr.loc);
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Call unlink: unlink(filename) returns 0 on success, -1 on error
    const result = this.ctx.emitCall("i32", "@unlink", `i8* ${filenamePtr}`);

    return result;
  }

  generateMkdirSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fs.mkdirSync() requires at least 1 argument (path)", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const fmtStr = this.ctx.createStringConstant("mkdir -p %s");
    const bufRaw = this.ctx.emitCall("i8*", "@GC_malloc", "i64 4096");
    // snprintf has variadic signature — keep as raw emit
    const written = this.ctx.nextTemp();
    this.ctx.emit(
      `${written} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufRaw}, i64 4096, i8* ${fmtStr}, i8* ${pathPtr})`,
    );
    const result = this.ctx.emitCall("i32", "@system", `i8* ${bufRaw}`);

    return result;
  }

  generateReaddirSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fs.readdirSync() requires 1 argument (path)", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.emitCall("%StringArray*", "@__fs_readdirSync", `i8* ${pathPtr}`);
    this.ctx.setVariableType(result, "%StringArray*");

    return result;
  }

  generateStatSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("fs.statSync() requires 1 argument (path)", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.emitCall("i8*", "@__fs_statSync", `i8* ${pathPtr}`);
    this.ctx.setVariableType(result, "%StatResult*");

    return result;
  }

  generateRenameSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError(
        "fs.renameSync() requires 2 arguments (oldPath, newPath)",
        expr.loc,
      );
    }

    const oldPath = this.ctx.generateExpression(expr.args[0], params);
    const newPath = this.ctx.generateExpression(expr.args[1], params);

    const result = this.ctx.emitCall("i32", "@rename", `i8* ${oldPath}, i8* ${newPath}`);

    return result;
  }

  generateCopyFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("fs.copyFileSync() requires 2 arguments (src, dest)", expr.loc);
    }

    const srcPath = this.ctx.generateExpression(expr.args[0], params);
    const destPath = this.ctx.generateExpression(expr.args[1], params);

    const srcMode = this.ctx.createStringConstant("r");
    const srcFp = this.ctx.emitCall("i8*", "@fopen", `i8* ${srcPath}, i8* ${srcMode}`);

    const srcNull = this.ctx.emitIcmp("eq", "i8*", srcFp, "null");

    const failLabel = this.ctx.nextLabel("copy_fail");
    const readLabel = this.ctx.nextLabel("copy_read");
    const endLabel = this.ctx.nextLabel("copy_end");

    this.ctx.emitBrCond(srcNull, failLabel, readLabel);

    this.ctx.emitLabel(failLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(readLabel);
    const seekEnd = this.ctx.emitCall("i32", "@fseek", `i8* ${srcFp}, i64 0, i32 2`);
    const fileSize = this.ctx.emitCall("i64", "@ftell", `i8* ${srcFp}`);
    const seekStart = this.ctx.emitCall("i32", "@fseek", `i8* ${srcFp}, i64 0, i32 0`);

    const buf = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${fileSize}`);
    const bytesRead = this.ctx.emitCall(
      "i64",
      "@fread",
      `i8* ${buf}, i64 1, i64 ${fileSize}, i8* ${srcFp}`,
    );
    const closeSrc = this.ctx.emitCall("i32", "@fclose", `i8* ${srcFp}`);

    const destMode = this.ctx.createStringConstant("w");
    const destFp = this.ctx.emitCall("i8*", "@fopen", `i8* ${destPath}, i8* ${destMode}`);
    const bytesWritten = this.ctx.emitCall(
      "i64",
      "@fwrite",
      `i8* ${buf}, i64 1, i64 ${fileSize}, i8* ${destFp}`,
    );
    const closeDest = this.ctx.emitCall("i32", "@fclose", `i8* ${destFp}`);

    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ -1, %${failLabel} ], [ 0, %${readLabel} ]`);

    return result;
  }

  private generateAsyncOneArg(
    methodName: string,
    asyncFnName: string,
    expr: MethodCallNode,
    params: string[],
  ): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(`fs.${methodName}() requires at least 1 argument`, expr.loc);
    }
    const pathPtr = this.ctx.generateExpression(expr.args[0], params);
    this.ctx.setUsesPromises(true);
    this.ctx.setUsesAsyncFs(true);
    const temp = this.ctx.emitCall("%Promise*", `@${asyncFnName}`, `i8* ${pathPtr}`);
    return temp;
  }

  private generateAsyncTwoArg(
    methodName: string,
    asyncFnName: string,
    expr: MethodCallNode,
    params: string[],
  ): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError(`fs.${methodName}() requires at least 2 arguments`, expr.loc);
    }
    const arg1 = this.ctx.generateExpression(expr.args[0], params);
    const arg2 = this.ctx.generateExpression(expr.args[1], params);
    this.ctx.setUsesPromises(true);
    this.ctx.setUsesAsyncFs(true);
    const temp = this.ctx.emitCall("%Promise*", `@${asyncFnName}`, `i8* ${arg1}, i8* ${arg2}`);
    return temp;
  }

  generateReadFile(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncOneArg("readFile", "__fs_readFile_async", expr, params);
  }

  generateWriteFile(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncTwoArg("writeFile", "__fs_writeFile_async", expr, params);
  }

  generateAppendFile(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncTwoArg("appendFile", "__fs_appendFile_async", expr, params);
  }

  generateReaddir(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncOneArg("readdir", "__fs_readdir_async", expr, params);
  }

  generateStat(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncOneArg("stat", "__fs_stat_async", expr, params);
  }

  generateUnlink(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncOneArg("unlink", "__fs_unlink_async", expr, params);
  }

  generateMkdir(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncOneArg("mkdir", "__fs_mkdir_async", expr, params);
  }

  generateRename(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncTwoArg("rename", "__fs_rename_async", expr, params);
  }

  generateCopyFile(expr: MethodCallNode, params: string[]): string {
    return this.generateAsyncTwoArg("copyFile", "__fs_copyFile_async", expr, params);
  }

  generateReaddirSyncHelper(): string {
    const isMac = process.platform === "darwin";
    const dNameOffset = isMac ? 21 : 19;
    let ir = "";
    ir += "define %StringArray* @__fs_readdirSync(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %dir = call i8* @opendir(i8* %path)\n";
    ir += "  %dir_null = icmp eq i8* %dir, null\n";
    ir += "  br i1 %dir_null, label %fail, label %init\n";
    ir += "\n";
    ir += "fail:\n";
    ir += "  %empty = call i8* @GC_malloc(i64 24)\n";
    ir += "  %empty_arr = bitcast i8* %empty to %StringArray*\n";
    ir += "  %empty_data = call i8* @GC_malloc(i64 8)\n";
    ir += "  %empty_data_typed = bitcast i8* %empty_data to i8**\n";
    ir += "  %ef0 = getelementptr inbounds %StringArray, %StringArray* %empty_arr, i32 0, i32 0\n";
    ir += "  store i8** %empty_data_typed, i8*** %ef0\n";
    ir += "  %ef1 = getelementptr inbounds %StringArray, %StringArray* %empty_arr, i32 0, i32 1\n";
    ir += "  store i32 0, i32* %ef1\n";
    ir += "  %ef2 = getelementptr inbounds %StringArray, %StringArray* %empty_arr, i32 0, i32 2\n";
    ir += "  store i32 0, i32* %ef2\n";
    ir += "  ret %StringArray* %empty_arr\n";
    ir += "\n";
    ir += "init:\n";
    ir += "  %init_data_raw = call i8* @GC_malloc(i64 512)\n";
    ir += "  %init_data = bitcast i8* %init_data_raw to i8**\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %len = phi i32 [ 0, %init ], [ %new_len, %store ], [ %len, %skip ]\n";
    ir += "  %cap = phi i32 [ 64, %init ], [ %final_cap, %store ], [ %cap, %skip ]\n";
    ir += "  %data = phi i8** [ %init_data, %init ], [ %final_data, %store ], [ %data, %skip ]\n";
    ir += "  %ent = call i8* @readdir(i8* %dir)\n";
    ir += "  %ent_null = icmp eq i8* %ent, null\n";
    ir += "  br i1 %ent_null, label %done, label %body\n";
    ir += "\n";
    ir += "body:\n";
    ir += `  %name_ptr = getelementptr inbounds i8, i8* %ent, i64 ${dNameOffset}\n`;
    ir += "  %c0 = load i8, i8* %name_ptr\n";
    ir += "  %is_dot_char = icmp eq i8 %c0, 46\n";
    ir += "  br i1 %is_dot_char, label %check_dot, label %proceed\n";
    ir += "\n";
    ir += "check_dot:\n";
    ir += "  %c1_ptr = getelementptr inbounds i8, i8* %name_ptr, i64 1\n";
    ir += "  %c1 = load i8, i8* %c1_ptr\n";
    ir += "  %is_single_dot = icmp eq i8 %c1, 0\n";
    ir += "  br i1 %is_single_dot, label %skip, label %check_dotdot\n";
    ir += "\n";
    ir += "check_dotdot:\n";
    ir += "  %is_dot2 = icmp eq i8 %c1, 46\n";
    ir += "  br i1 %is_dot2, label %check_dotdot2, label %proceed\n";
    ir += "\n";
    ir += "check_dotdot2:\n";
    ir += "  %c2_ptr = getelementptr inbounds i8, i8* %name_ptr, i64 2\n";
    ir += "  %c2 = load i8, i8* %c2_ptr\n";
    ir += "  %is_double_dot = icmp eq i8 %c2, 0\n";
    ir += "  br i1 %is_double_dot, label %skip, label %proceed\n";
    ir += "\n";
    ir += "skip:\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "proceed:\n";
    ir += "  %name_copy = call i8* @strdup(i8* %name_ptr)\n";
    ir += "  %need_grow = icmp eq i32 %len, %cap\n";
    ir += "  br i1 %need_grow, label %grow, label %store\n";
    ir += "\n";
    ir += "grow:\n";
    ir += "  %new_cap = mul i32 %cap, 2\n";
    ir += "  %new_cap_i64 = sext i32 %new_cap to i64\n";
    ir += "  %new_bytes = mul i64 %new_cap_i64, 8\n";
    ir += "  %old_i8 = bitcast i8** %data to i8*\n";
    ir += "  %new_alloc = call i8* @GC_realloc(i8* %old_i8, i64 %new_bytes)\n";
    ir += "  %new_data = bitcast i8* %new_alloc to i8**\n";
    ir += "  br label %store\n";
    ir += "\n";
    ir += "store:\n";
    ir += "  %final_data = phi i8** [ %data, %proceed ], [ %new_data, %grow ]\n";
    ir += "  %final_cap = phi i32 [ %cap, %proceed ], [ %new_cap, %grow ]\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n";
    ir += "  store i8* %name_copy, i8** %elem_ptr\n";
    ir += "  %new_len = add i32 %len, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  call i32 @closedir(i8* %dir)\n";
    ir += "  %arr_raw = call i8* @GC_malloc(i64 24)\n";
    ir += "  %arr = bitcast i8* %arr_raw to %StringArray*\n";
    ir += "  %f0 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 0\n";
    ir += "  store i8** %data, i8*** %f0\n";
    ir += "  %f1 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 1\n";
    ir += "  store i32 %len, i32* %f1\n";
    ir += "  %f2 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 2\n";
    ir += "  store i32 %cap, i32* %f2\n";
    ir += "  ret %StringArray* %arr\n";
    ir += "}\n\n";
    return ir;
  }

  generateStatSyncHelper(): string {
    const isMac = process.platform === "darwin";
    const statBufSize = isMac ? 144 : 144;
    const modeOffset = isMac ? 4 : 24;
    const sizeOffset = isMac ? 96 : 48;
    const modeType = isMac ? "i16" : "i32";

    let ir = "";
    ir += "%StatResult = type { double, double, double }\n\n";
    ir += "define i8* @__fs_statSync(i8* %path) {\n";
    ir += "entry:\n";
    ir += `  %buf = call i8* @GC_malloc(i64 ${statBufSize})\n`;
    ir += "  %rc = call i32 @stat(i8* %path, i8* %buf)\n";
    ir += "  %result = call i8* @GC_malloc(i64 24)\n";
    ir += "  %typed = bitcast i8* %result to %StatResult*\n";
    ir += "\n";
    ir += `  %size_ptr = getelementptr inbounds i8, i8* %buf, i64 ${sizeOffset}\n`;
    ir += "  %size_typed = bitcast i8* %size_ptr to i64*\n";
    ir += "  %size_i64 = load i64, i64* %size_typed\n";
    ir += "  %size_dbl = sitofp i64 %size_i64 to double\n";
    ir += "  %f0 = getelementptr inbounds %StatResult, %StatResult* %typed, i32 0, i32 0\n";
    ir += "  store double %size_dbl, double* %f0\n";
    ir += "\n";
    ir += `  %mode_ptr = getelementptr inbounds i8, i8* %buf, i64 ${modeOffset}\n`;
    ir += `  %mode_typed = bitcast i8* %mode_ptr to ${modeType}*\n`;
    ir += `  %mode_raw = load ${modeType}, ${modeType}* %mode_typed\n`;
    if (isMac) {
      ir += "  %mode = zext i16 %mode_raw to i32\n";
    } else {
      ir += "  %mode = add i32 %mode_raw, 0\n";
    }
    ir += "  %masked = and i32 %mode, 61440\n";
    ir += "\n";
    ir += "  %is_file_i1 = icmp eq i32 %masked, 32768\n";
    ir += "  %is_file_i32 = zext i1 %is_file_i1 to i32\n";
    ir += "  %is_file_dbl = sitofp i32 %is_file_i32 to double\n";
    ir += "  %f1 = getelementptr inbounds %StatResult, %StatResult* %typed, i32 0, i32 1\n";
    ir += "  store double %is_file_dbl, double* %f1\n";
    ir += "\n";
    ir += "  %is_dir_i1 = icmp eq i32 %masked, 16384\n";
    ir += "  %is_dir_i32 = zext i1 %is_dir_i1 to i32\n";
    ir += "  %is_dir_dbl = sitofp i32 %is_dir_i32 to double\n";
    ir += "  %f2 = getelementptr inbounds %StatResult, %StatResult* %typed, i32 0, i32 2\n";
    ir += "  store double %is_dir_dbl, double* %f2\n";
    ir += "\n";
    ir += "  ret i8* %result\n";
    ir += "}\n\n";
    return ir;
  }
}

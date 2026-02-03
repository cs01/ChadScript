import { MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

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
    return exprObjBase.type === 'variable' &&
           (expr.object as any).name === 'fs' &&
           ['readFileSync', 'writeFileSync', 'existsSync', 'unlinkSync'].indexOf(expr.method) !== -1;
  }

  /**
   * Generate LLVM IR for fs.readFileSync(filename)
   * Reads entire file into a string
   */
  generateReadFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('fs.readFileSync() requires at least 1 argument (filename)');
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Create "r" mode string for fopen
    const modeStr = this.ctx.createStringConstant('r');

    // Open file: FILE* fp = fopen(filename, "r")
    const filePtr = this.ctx.nextTemp();
    this.ctx.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

    // Check if file opened successfully
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

    const failLabel = this.ctx.nextLabel('read_fail');
    const successLabel = this.ctx.nextLabel('read_success');
    const endLabel = this.ctx.nextLabel('read_end');

    this.ctx.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

    // Failure case: return empty string
    this.ctx.emit(`${failLabel}:`);
    const emptyStr = this.ctx.createStringConstant('');
    this.ctx.emit(`br label %${endLabel}`);

    // Success case: read file
    this.ctx.emit(`${successLabel}:`);

    // Seek to end to get file size: fseek(fp, 0, SEEK_END)
    const seekEnd = this.ctx.nextTemp();
    this.ctx.emit(`${seekEnd} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 2)`);

    // Get file size: size = ftell(fp)
    const fileSize = this.ctx.nextTemp();
    this.ctx.emit(`${fileSize} = call i64 @ftell(i8* ${filePtr})`);

    // Seek back to beginning: fseek(fp, 0, SEEK_SET)
    const seekStart = this.ctx.nextTemp();
    this.ctx.emit(`${seekStart} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 0)`);

    // Allocate buffer: GC_malloc_atomic(size + 1) for null terminator
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 ${fileSize}, 1`);
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    // Read file: fread(buffer, 1, size, fp)
    const bytesRead = this.ctx.nextTemp();
    this.ctx.emit(`${bytesRead} = call i64 @fread(i8* ${buffer}, i64 1, i64 ${fileSize}, i8* ${filePtr})`);

    // Null-terminate the string
    const nullPos = this.ctx.nextTemp();
    this.ctx.emit(`${nullPos} = getelementptr inbounds i8, i8* ${buffer}, i64 ${fileSize}`);
    this.ctx.emit(`store i8 0, i8* ${nullPos}`);

    // Close file: fclose(fp)
    const closeResult = this.ctx.nextTemp();
    this.ctx.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);

    this.ctx.emit(`br label %${endLabel}`);

    // End: phi node to select result
    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${emptyStr}, %${failLabel} ], [ ${buffer}, %${successLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  /**
   * Generate LLVM IR for fs.writeFileSync(filename, data)
   * Writes data to file, overwriting if it exists
   */
  generateWriteFileSync(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('fs.writeFileSync() requires at least 2 arguments (filename, data)');
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);
    const dataPtr = this.ctx.generateExpression(expr.args[1], params);

    // Create "w" mode string for fopen
    const modeStr = this.ctx.createStringConstant('w');

    // Open file: FILE* fp = fopen(filename, "w")
    const filePtr = this.ctx.nextTemp();
    this.ctx.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

    // Check if file opened successfully
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

    const failLabel = this.ctx.nextLabel('write_fail');
    const successLabel = this.ctx.nextLabel('write_success');
    const endLabel = this.ctx.nextLabel('write_end');

    this.ctx.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

    // Failure case: return -1
    this.ctx.emit(`${failLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    // Success case: write file
    this.ctx.emit(`${successLabel}:`);

    // Get data length: strlen(data)
    const dataLen = this.ctx.nextTemp();
    this.ctx.emit(`${dataLen} = call i64 @strlen(i8* ${dataPtr})`);

    // Write data: fwrite(data, 1, len, fp)
    const bytesWritten = this.ctx.nextTemp();
    this.ctx.emit(`${bytesWritten} = call i64 @fwrite(i8* ${dataPtr}, i64 1, i64 ${dataLen}, i8* ${filePtr})`);

    // Close file: fclose(fp)
    const closeResult = this.ctx.nextTemp();
    this.ctx.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);

    this.ctx.emit(`br label %${endLabel}`);

    // End: phi node to return success/failure
    this.ctx.emit(`${endLabel}:`);
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
      throw new Error('fs.existsSync() requires 1 argument (filename)');
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Try to open file in read mode
    const modeStr = this.ctx.createStringConstant('r');
    const filePtr = this.ctx.nextTemp();
    this.ctx.emit(`${filePtr} = call i8* @fopen(i8* ${filenamePtr}, i8* ${modeStr})`);

    // Check if file opened successfully (NULL means doesn't exist)
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

    const existsLabel = this.ctx.nextLabel('exists');
    const notExistsLabel = this.ctx.nextLabel('not_exists');
    const endLabel = this.ctx.nextLabel('exists_end');

    this.ctx.emit(`br i1 ${isNull}, label %${notExistsLabel}, label %${existsLabel}`);

    // File exists: close it and return 1
    this.ctx.emit(`${existsLabel}:`);
    const closeResult = this.ctx.nextTemp();
    this.ctx.emit(`${closeResult} = call i32 @fclose(i8* ${filePtr})`);
    this.ctx.emit(`br label %${endLabel}`);

    // File doesn't exist: return 0
    this.ctx.emit(`${notExistsLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    // End: phi node to return 1 (exists) or 0 (doesn't exist)
    this.ctx.emit(`${endLabel}:`);
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
      throw new Error('fs.unlinkSync() requires 1 argument (filename)');
    }

    const filenamePtr = this.ctx.generateExpression(expr.args[0], params);

    // Call unlink: unlink(filename) returns 0 on success, -1 on error
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i32 @unlink(i8* ${filenamePtr})`);

    return result;
  }
}

import { MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

export class SqliteGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'variable') return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== 'sqlite') return false;
    const supported = ['open', 'exec', 'get', 'all', 'close'];
    return supported.indexOf(expr.method) !== -1;
  }

  generateOpen(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('sqlite.open() requires 1 argument (database path)');
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const dbPtrPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dbPtrPtr} = call i8* @GC_malloc(i64 8)`);
    const dbPtrTyped = this.ctx.nextTemp();
    this.ctx.emit(`${dbPtrTyped} = bitcast i8* ${dbPtrPtr} to i8**`);

    const openResult = this.ctx.nextTemp();
    this.ctx.emit(`${openResult} = call i32 @sqlite3_open(i8* ${pathPtr}, i8** ${dbPtrTyped})`);

    const dbPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dbPtr} = load i8*, i8** ${dbPtrTyped}`);
    this.ctx.setVariableType(dbPtr, 'i8*');

    return dbPtr;
  }

  generateExec(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('sqlite.exec() requires 2 arguments (db, sql)');
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i32 @sqlite3_exec(i8* ${dbPtr}, i8* ${sqlPtr}, i8* null, i8* null, i8** null)`);

    return result;
  }

  generateGet(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('sqlite.get() requires 2 arguments (db, sql)');
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__sqlite_get(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateAll(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('sqlite.all() requires 2 arguments (db, sql)');
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %StringArray* @__sqlite_all(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, '%StringArray*');

    return result;
  }

  generateClose(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('sqlite.close() requires 1 argument (db)');
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i32 @sqlite3_close(i8* ${dbPtr})`);

    return result;
  }

  generateSqliteGetHelper(): string {
    let ir = '';
    ir += 'define i8* @__sqlite_get(i8* %db, i8* %sql) {\n';
    ir += 'entry:\n';
    ir += '  %sql_len = call i64 @strlen(i8* %sql)\n';
    ir += '  %sql_len_i32 = trunc i64 %sql_len to i32\n';
    ir += '  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n';
    ir += '  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n';
    ir += '  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n';
    ir += '  %stmt = load i8*, i8** %stmt_ptr\n';
    ir += '  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n';
    ir += '  %is_row = icmp eq i32 %step_rc, 100\n';
    ir += '  br i1 %is_row, label %has_row, label %no_row\n';
    ir += '\n';
    ir += 'has_row:\n';
    ir += '  %col_text = call i8* @sqlite3_column_text(i8* %stmt, i32 0)\n';
    ir += '  %result = call i8* @strdup(i8* %col_text)\n';
    ir += '  call i32 @sqlite3_finalize(i8* %stmt)\n';
    ir += '  ret i8* %result\n';
    ir += '\n';
    ir += 'no_row:\n';
    ir += '  call i32 @sqlite3_finalize(i8* %stmt)\n';
    ir += '  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n';
    ir += '}\n\n';
    return ir;
  }

  generateSqliteAllHelper(): string {
    let ir = '';
    ir += 'define %StringArray* @__sqlite_all(i8* %db, i8* %sql) {\n';
    ir += 'entry:\n';
    ir += '  %sql_len = call i64 @strlen(i8* %sql)\n';
    ir += '  %sql_len_i32 = trunc i64 %sql_len to i32\n';
    ir += '  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n';
    ir += '  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n';
    ir += '  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n';
    ir += '  %stmt = load i8*, i8** %stmt_ptr\n';
    ir += '  %init_data_raw = call i8* @GC_malloc(i64 512)\n';
    ir += '  %init_data = bitcast i8* %init_data_raw to i8**\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'loop:\n';
    ir += '  %len = phi i32 [ 0, %entry ], [ %new_len, %store ]\n';
    ir += '  %cap = phi i32 [ 64, %entry ], [ %final_cap, %store ]\n';
    ir += '  %data = phi i8** [ %init_data, %entry ], [ %final_data, %store ]\n';
    ir += '  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n';
    ir += '  %is_row = icmp eq i32 %step_rc, 100\n';
    ir += '  br i1 %is_row, label %body, label %done\n';
    ir += '\n';
    ir += 'body:\n';
    ir += '  %col_text = call i8* @sqlite3_column_text(i8* %stmt, i32 0)\n';
    ir += '  %text_copy = call i8* @strdup(i8* %col_text)\n';
    ir += '  %need_grow = icmp eq i32 %len, %cap\n';
    ir += '  br i1 %need_grow, label %grow, label %store\n';
    ir += '\n';
    ir += 'grow:\n';
    ir += '  %new_cap = mul i32 %cap, 2\n';
    ir += '  %new_cap_i64 = sext i32 %new_cap to i64\n';
    ir += '  %new_bytes = mul i64 %new_cap_i64, 8\n';
    ir += '  %old_i8 = bitcast i8** %data to i8*\n';
    ir += '  %new_alloc = call i8* @GC_realloc(i8* %old_i8, i64 %new_bytes)\n';
    ir += '  %new_data = bitcast i8* %new_alloc to i8**\n';
    ir += '  br label %store\n';
    ir += '\n';
    ir += 'store:\n';
    ir += '  %final_data = phi i8** [ %data, %body ], [ %new_data, %grow ]\n';
    ir += '  %final_cap = phi i32 [ %cap, %body ], [ %new_cap, %grow ]\n';
    ir += '  %len_i64 = sext i32 %len to i64\n';
    ir += '  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n';
    ir += '  store i8* %text_copy, i8** %elem_ptr\n';
    ir += '  %new_len = add i32 %len, 1\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  call i32 @sqlite3_finalize(i8* %stmt)\n';
    ir += '  %arr_raw = call i8* @GC_malloc(i64 24)\n';
    ir += '  %arr = bitcast i8* %arr_raw to %StringArray*\n';
    ir += '  %f0 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 0\n';
    ir += '  store i8** %data, i8*** %f0\n';
    ir += '  %f1 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 1\n';
    ir += '  store i32 %len, i32* %f1\n';
    ir += '  %f2 = getelementptr inbounds %StringArray, %StringArray* %arr, i32 0, i32 2\n';
    ir += '  store i32 %cap, i32* %f2\n';
    ir += '  ret %StringArray* %arr\n';
    ir += '}\n\n';
    return ir;
  }
}

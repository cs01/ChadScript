import { MethodCallNode, Expression, ArrayNode } from '../../ast/types.js';

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
      return this.ctx.emitError('sqlite.open() requires 1 argument (database path)', expr.loc);
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
      return this.ctx.emitError('sqlite.exec() requires 2 arguments (db, sql)', expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(`${result} = call i32 @__sqlite_exec_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`);
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i32 @sqlite3_exec(i8* ${dbPtr}, i8* ${sqlPtr}, i8* null, i8* null, i8** null)`);

    return result;
  }

  generateGet(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError('sqlite.get() requires 2 arguments (db, sql)', expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(`${result} = call i8* @__sqlite_get_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`);
      this.ctx.setVariableType(result, 'i8*');
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__sqlite_get(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateAll(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError('sqlite.all() requires 2 arguments (db, sql)', expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(`${result} = call %StringArray* @__sqlite_all_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`);
      this.ctx.setVariableType(result, '%StringArray*');
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %StringArray* @__sqlite_all(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, '%StringArray*');

    return result;
  }

  generateClose(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError('sqlite.close() requires 1 argument (db)', expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i32 @sqlite3_close(i8* ${dbPtr})`);

    return result;
  }

  private buildParamsArray(argExpr: Expression, params: string[]): string {
    const arrNode = argExpr as ArrayNode;
    const elements = arrNode.elements;
    const count = elements.length;

    const dataRaw = this.ctx.nextTemp();
    this.ctx.emit(`${dataRaw} = call i8* @GC_malloc(i64 ${count * 8})`);
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = bitcast i8* ${dataRaw} to i8**`);

    for (let i = 0; i < count; i++) {
      const elem = elements[i];
      const val = this.ctx.generateExpression(elem, params);
      const resolvedType = this.ctx.getVariableType(val);

      let strVal: string;
      if (resolvedType === 'double') {
        strVal = this.ctx.nextTemp();
        this.ctx.emit(`${strVal} = call i8* @__double_to_string(double ${val})`);
      } else {
        strVal = val;
      }

      const ptr = this.ctx.nextTemp();
      this.ctx.emit(`${ptr} = getelementptr inbounds i8*, i8** ${data}, i64 ${i}`);
      this.ctx.emit(`store i8* ${strVal}, i8** ${ptr}`);
    }

    const arrRaw = this.ctx.nextTemp();
    this.ctx.emit(`${arrRaw} = call i8* @GC_malloc(i64 24)`);
    const arr = this.ctx.nextTemp();
    this.ctx.emit(`${arr} = bitcast i8* ${arrRaw} to %StringArray*`);
    const f0 = this.ctx.nextTemp();
    this.ctx.emit(`${f0} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 0`);
    this.ctx.emit(`store i8** ${data}, i8*** ${f0}`);
    const f1 = this.ctx.nextTemp();
    this.ctx.emit(`${f1} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 1`);
    this.ctx.emit(`store i32 ${count}, i32* ${f1}`);
    const f2 = this.ctx.nextTemp();
    this.ctx.emit(`${f2} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 2`);
    this.ctx.emit(`store i32 ${count}, i32* ${f2}`);

    this.ctx.setVariableType(arr, '%StringArray*');
    return arr;
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

  generateSqliteBindParamsHelper(): string {
    let ir = '';
    ir += 'define void @__sqlite_bind_params(i8* %stmt, %StringArray* %params) {\n';
    ir += 'entry:\n';
    ir += '  %len_ptr = getelementptr inbounds %StringArray, %StringArray* %params, i32 0, i32 1\n';
    ir += '  %len = load i32, i32* %len_ptr\n';
    ir += '  %data_ptr = getelementptr inbounds %StringArray, %StringArray* %params, i32 0, i32 0\n';
    ir += '  %data = load i8**, i8*** %data_ptr\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'loop:\n';
    ir += '  %i = phi i32 [ 0, %entry ], [ %next_i, %body ]\n';
    ir += '  %done = icmp sge i32 %i, %len\n';
    ir += '  br i1 %done, label %exit, label %body\n';
    ir += '\n';
    ir += 'body:\n';
    ir += '  %i_i64 = sext i32 %i to i64\n';
    ir += '  %elem_ptr = getelementptr inbounds i8*, i8** %data, i64 %i_i64\n';
    ir += '  %elem = load i8*, i8** %elem_ptr\n';
    ir += '  %bind_idx = add i32 %i, 1\n';
    ir += '  call i32 @sqlite3_bind_text(i8* %stmt, i32 %bind_idx, i8* %elem, i32 -1, i64 0)\n';
    ir += '  %next_i = add i32 %i, 1\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'exit:\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generateSqliteExecWithParamsHelper(): string {
    let ir = '';
    ir += 'define i32 @__sqlite_exec_params(i8* %db, i8* %sql, %StringArray* %params) {\n';
    ir += 'entry:\n';
    ir += '  %sql_len = call i64 @strlen(i8* %sql)\n';
    ir += '  %sql_len_i32 = trunc i64 %sql_len to i32\n';
    ir += '  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n';
    ir += '  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n';
    ir += '  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n';
    ir += '  %stmt = load i8*, i8** %stmt_ptr\n';
    ir += '  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n';
    ir += '  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n';
    ir += '  call i32 @sqlite3_finalize(i8* %stmt)\n';
    ir += '  ret i32 %step_rc\n';
    ir += '}\n\n';
    return ir;
  }

  generateSqliteGetWithParamsHelper(): string {
    let ir = '';
    ir += 'define i8* @__sqlite_get_params(i8* %db, i8* %sql, %StringArray* %params) {\n';
    ir += 'entry:\n';
    ir += '  %sql_len = call i64 @strlen(i8* %sql)\n';
    ir += '  %sql_len_i32 = trunc i64 %sql_len to i32\n';
    ir += '  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n';
    ir += '  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n';
    ir += '  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n';
    ir += '  %stmt = load i8*, i8** %stmt_ptr\n';
    ir += '  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n';
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

  generateSqliteAllWithParamsHelper(): string {
    let ir = '';
    ir += 'define %StringArray* @__sqlite_all_params(i8* %db, i8* %sql, %StringArray* %params) {\n';
    ir += 'entry:\n';
    ir += '  %sql_len = call i64 @strlen(i8* %sql)\n';
    ir += '  %sql_len_i32 = trunc i64 %sql_len to i32\n';
    ir += '  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n';
    ir += '  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n';
    ir += '  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n';
    ir += '  %stmt = load i8*, i8** %stmt_ptr\n';
    ir += '  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n';
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

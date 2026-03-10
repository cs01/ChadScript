import { MethodCallNode, Expression, ArrayNode, VariableNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class SqliteGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "sqlite") return false;
    const supported = ["open", "exec", "get", "getRow", "all", "query", "close"];
    return supported.indexOf(expr.method) !== -1;
  }

  generateOpen(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("sqlite.open() requires 1 argument (database path)", expr.loc);
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
    this.ctx.setVariableType(dbPtr, "i8*");

    return dbPtr;
  }

  generateExec(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("sqlite.exec() requires 2 arguments (db, sql)", expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = call i32 @__sqlite_exec_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`,
      );
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i32 @sqlite3_exec(i8* ${dbPtr}, i8* ${sqlPtr}, i8* null, i8* null, i8** null)`,
    );

    return result;
  }

  generateGet(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("sqlite.get() requires 2 arguments (db, sql)", expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = call i8* @__sqlite_get_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`,
      );
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__sqlite_get(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  // sqlite.getRow() — returns a single typed struct (i8*) instead of a pipe-delimited string
  generateGetRow(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("sqlite.getRow() requires 2 arguments (db, sql)", expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = call i8* @__sqlite_get_row_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`,
      );
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__sqlite_get_row(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  // sqlite.query() — returns %ObjectArray* of typed structs instead of pipe-delimited strings
  generateQuery(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("sqlite.query() requires 2 arguments (db, sql)", expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = call %ObjectArray* @__sqlite_query_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`,
      );
      this.ctx.setVariableType(result, "%ObjectArray*");
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %ObjectArray* @__sqlite_query(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, "%ObjectArray*");

    return result;
  }

  generateAll(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("sqlite.all() requires 2 arguments (db, sql)", expr.loc);
    }

    const dbPtr = this.ctx.generateExpression(expr.args[0], params);
    const sqlPtr = this.ctx.generateExpression(expr.args[1], params);

    if (expr.args.length >= 3) {
      const paramsArr = this.buildParamsArray(expr.args[2], params);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = call %StringArray* @__sqlite_all_params(i8* ${dbPtr}, i8* ${sqlPtr}, %StringArray* ${paramsArr})`,
      );
      this.ctx.setVariableType(result, "%StringArray*");
      return result;
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %StringArray* @__sqlite_all(i8* ${dbPtr}, i8* ${sqlPtr})`);
    this.ctx.setVariableType(result, "%StringArray*");

    return result;
  }

  generateClose(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("sqlite.close() requires 1 argument (db)", expr.loc);
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
      if (resolvedType === "double" || resolvedType === "i64") {
        const dblVal = this.ctx.ensureDouble(val);
        strVal = this.ctx.nextTemp();
        this.ctx.emit(`${strVal} = call i8* @__double_to_string(double ${dblVal})`);
        this.ctx.setVariableType(strVal, "i8*");
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
    this.ctx.emit(
      `${f0} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 0`,
    );
    this.ctx.emit(`store i8** ${data}, i8*** ${f0}`);
    const f1 = this.ctx.nextTemp();
    this.ctx.emit(
      `${f1} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 1`,
    );
    this.ctx.emit(`store i32 ${count}, i32* ${f1}`);
    const f2 = this.ctx.nextTemp();
    this.ctx.emit(
      `${f2} = getelementptr inbounds %StringArray, %StringArray* ${arr}, i32 0, i32 2`,
    );
    this.ctx.emit(`store i32 ${count}, i32* ${f2}`);

    this.ctx.setVariableType(arr, "%StringArray*");
    return arr;
  }

  generateSqliteRowToStringHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_row_to_string(i8* %stmt, i32 %col_count) {\n";
    ir += "entry:\n";
    ir += "  %is_single = icmp eq i32 %col_count, 1\n";
    ir += "  br i1 %is_single, label %single_col, label %multi_col_start\n";
    ir += "\n";
    ir += "single_col:\n";
    ir += "  %sc_text = call i8* @sqlite3_column_text(i8* %stmt, i32 0)\n";
    ir += "  %sc_copy = call i8* @strdup(i8* %sc_text)\n";
    ir += "  ret i8* %sc_copy\n";
    ir += "\n";
    ir += "multi_col_start:\n";
    ir += "  %total_len_init = sext i32 0 to i64\n";
    ir += "  br label %len_loop\n";
    ir += "\n";
    ir += "len_loop:\n";
    ir += "  %li = phi i32 [ 0, %multi_col_start ], [ %li_next, %len_add ]\n";
    ir += "  %total_len = phi i64 [ 0, %multi_col_start ], [ %total_len_next, %len_add ]\n";
    ir += "  %li_done = icmp sge i32 %li, %col_count\n";
    ir += "  br i1 %li_done, label %alloc, label %len_body\n";
    ir += "\n";
    ir += "len_body:\n";
    ir += "  %lt = call i8* @sqlite3_column_text(i8* %stmt, i32 %li)\n";
    ir += "  %lt_nn = icmp ne i8* %lt, null\n";
    ir += "  br i1 %lt_nn, label %len_has_text, label %len_null_text\n";
    ir += "\n";
    ir += "len_has_text:\n";
    ir += "  %lt_len = call i64 @strlen(i8* %lt)\n";
    ir += "  br label %len_add\n";
    ir += "\n";
    ir += "len_null_text:\n";
    ir += "  br label %len_add\n";
    ir += "\n";
    ir += "len_add:\n";
    ir += "  %col_len = phi i64 [ %lt_len, %len_has_text ], [ 0, %len_null_text ]\n";
    ir += "  %total_len_with_col = add i64 %total_len, %col_len\n";
    ir += "  %is_not_last = icmp slt i32 %li, %col_count\n";
    ir += "  %pipe_extra = select i1 %is_not_last, i64 1, i64 0\n";
    ir += "  %total_len_next = add i64 %total_len_with_col, %pipe_extra\n";
    ir += "  %li_next = add i32 %li, 1\n";
    ir += "  br label %len_loop\n";
    ir += "\n";
    ir += "alloc:\n";
    ir += "  %buf_size = add i64 %total_len, 1\n";
    ir += "  %buf = call i8* @GC_malloc_atomic(i64 %buf_size)\n";
    ir += "  store i8 0, i8* %buf\n";
    ir += "  br label %cat_loop\n";
    ir += "\n";
    ir += "cat_loop:\n";
    ir += "  %ci = phi i32 [ 0, %alloc ], [ %ci_next, %cat_continue ]\n";
    ir += "  %ci_done = icmp sge i32 %ci, %col_count\n";
    ir += "  br i1 %ci_done, label %cat_done, label %cat_body\n";
    ir += "\n";
    ir += "cat_body:\n";
    ir += "  %need_pipe = icmp sgt i32 %ci, 0\n";
    ir += "  br i1 %need_pipe, label %add_pipe, label %add_col\n";
    ir += "\n";
    ir += "add_pipe:\n";
    ir += "  %cur_len_p = call i64 @strlen(i8* %buf)\n";
    ir += "  %pipe_ptr = getelementptr inbounds i8, i8* %buf, i64 %cur_len_p\n";
    ir += "  store i8 124, i8* %pipe_ptr\n";
    ir += "  %after_pipe = add i64 %cur_len_p, 1\n";
    ir += "  %null_ptr_p = getelementptr inbounds i8, i8* %buf, i64 %after_pipe\n";
    ir += "  store i8 0, i8* %null_ptr_p\n";
    ir += "  br label %add_col\n";
    ir += "\n";
    ir += "add_col:\n";
    ir += "  %ct = call i8* @sqlite3_column_text(i8* %stmt, i32 %ci)\n";
    ir += "  %ct_nn = icmp ne i8* %ct, null\n";
    ir += "  br i1 %ct_nn, label %cat_has_text, label %cat_continue\n";
    ir += "\n";
    ir += "cat_has_text:\n";
    ir += "  call i8* @strcat(i8* %buf, i8* %ct)\n";
    ir += "  br label %cat_continue\n";
    ir += "\n";
    ir += "cat_continue:\n";
    ir += "  %ci_next = add i32 %ci, 1\n";
    ir += "  br label %cat_loop\n";
    ir += "\n";
    ir += "cat_done:\n";
    ir += "  ret i8* %buf\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteGetHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_get(i8* %db, i8* %sql) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %has_row, label %no_row\n";
    ir += "\n";
    ir += "has_row:\n";
    ir += "  %col_count = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %result = call i8* @__sqlite_row_to_string(i8* %stmt, i32 %col_count)\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* %result\n";
    ir += "\n";
    ir += "no_row:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteAllHelper(): string {
    let ir = "";
    ir += "define %StringArray* @__sqlite_all(i8* %db, i8* %sql) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  %init_data_raw = call i8* @GC_malloc(i64 512)\n";
    ir += "  %init_data = bitcast i8* %init_data_raw to i8**\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %len = phi i32 [ 0, %entry ], [ %new_len, %store ]\n";
    ir += "  %cap = phi i32 [ 64, %entry ], [ %final_cap, %store ]\n";
    ir += "  %data = phi i8** [ %init_data, %entry ], [ %final_data, %store ]\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %body, label %done\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %col_count = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %text_copy = call i8* @__sqlite_row_to_string(i8* %stmt, i32 %col_count)\n";
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
    ir += "  %final_data = phi i8** [ %data, %body ], [ %new_data, %grow ]\n";
    ir += "  %final_cap = phi i32 [ %cap, %body ], [ %new_cap, %grow ]\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n";
    ir += "  store i8* %text_copy, i8** %elem_ptr\n";
    ir += "  %new_len = add i32 %len, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
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

  generateSqliteBindParamsHelper(): string {
    let ir = "";
    ir += "define void @__sqlite_bind_params(i8* %stmt, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %len_ptr = getelementptr inbounds %StringArray, %StringArray* %params, i32 0, i32 1\n";
    ir += "  %len = load i32, i32* %len_ptr\n";
    ir +=
      "  %data_ptr = getelementptr inbounds %StringArray, %StringArray* %params, i32 0, i32 0\n";
    ir += "  %data = load i8**, i8*** %data_ptr\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %i = phi i32 [ 0, %entry ], [ %next_i, %body ]\n";
    ir += "  %done = icmp sge i32 %i, %len\n";
    ir += "  br i1 %done, label %exit, label %body\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %i_i64 = sext i32 %i to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %data, i64 %i_i64\n";
    ir += "  %elem = load i8*, i8** %elem_ptr\n";
    ir += "  %bind_idx = add i32 %i, 1\n";
    ir += "  call i32 @sqlite3_bind_text(i8* %stmt, i32 %bind_idx, i8* %elem, i32 -1, i64 0)\n";
    ir += "  %next_i = add i32 %i, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "exit:\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteExecWithParamsHelper(): string {
    let ir = "";
    ir += "define i32 @__sqlite_exec_params(i8* %db, i8* %sql, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i32 %step_rc\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteGetWithParamsHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_get_params(i8* %db, i8* %sql, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %has_row, label %no_row\n";
    ir += "\n";
    ir += "has_row:\n";
    ir += "  %col_count_gp = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %result = call i8* @__sqlite_row_to_string(i8* %stmt, i32 %col_count_gp)\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* %result\n";
    ir += "\n";
    ir += "no_row:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n";
    ir += "}\n\n";
    return ir;
  }

  // Converts a single sqlite row into a flat struct of i8* fields (one per column).
  // Each field is strdup'd column text, or "" for NULL. Returns i8* (opaque struct pointer).
  generateSqliteRowToStructHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_row_to_struct(i8* %stmt, i32 %col_count) {\n";
    ir += "entry:\n";
    // Allocate struct: col_count * 8 bytes (each field is an i8* = 8 bytes)
    ir += "  %col_count_i64 = sext i32 %col_count to i64\n";
    ir += "  %struct_size = mul i64 %col_count_i64, 8\n";
    ir += "  %struct_raw = call i8* @GC_malloc(i64 %struct_size)\n";
    ir += "  %struct_ptr = bitcast i8* %struct_raw to i8**\n";
    ir += "  br label %col_loop\n";
    ir += "\n";
    ir += "col_loop:\n";
    ir += "  %i = phi i32 [ 0, %entry ], [ %next_i, %col_store ]\n";
    ir += "  %done = icmp sge i32 %i, %col_count\n";
    ir += "  br i1 %done, label %exit, label %col_body\n";
    ir += "\n";
    ir += "col_body:\n";
    ir += "  %text = call i8* @sqlite3_column_text(i8* %stmt, i32 %i)\n";
    ir += "  %is_null = icmp eq i8* %text, null\n";
    ir += "  br i1 %is_null, label %null_text, label %has_text\n";
    ir += "\n";
    ir += "has_text:\n";
    ir += "  %copy = call i8* @strdup(i8* %text)\n";
    ir += "  br label %col_store\n";
    ir += "\n";
    ir += "null_text:\n";
    ir +=
      "  %empty = call i8* @strdup(i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0))\n";
    ir += "  br label %col_store\n";
    ir += "\n";
    ir += "col_store:\n";
    ir += "  %val = phi i8* [ %copy, %has_text ], [ %empty, %null_text ]\n";
    ir += "  %i_i64 = sext i32 %i to i64\n";
    ir += "  %slot = getelementptr inbounds i8*, i8** %struct_ptr, i64 %i_i64\n";
    ir += "  store i8* %val, i8** %slot\n";
    ir += "  %next_i = add i32 %i, 1\n";
    ir += "  br label %col_loop\n";
    ir += "\n";
    ir += "exit:\n";
    ir += "  ret i8* %struct_raw\n";
    ir += "}\n\n";
    return ir;
  }

  // Returns %ObjectArray* — each element is a struct pointer built by @__sqlite_row_to_struct.
  // Mirrors @__sqlite_all but produces ObjectArray instead of StringArray.
  generateSqliteQueryHelper(): string {
    let ir = "";
    ir += "define %ObjectArray* @__sqlite_query(i8* %db, i8* %sql) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  %init_data_raw = call i8* @GC_malloc(i64 512)\n";
    ir += "  %init_data = bitcast i8* %init_data_raw to i8**\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %len = phi i32 [ 0, %entry ], [ %new_len, %store ]\n";
    ir += "  %cap = phi i32 [ 64, %entry ], [ %final_cap, %store ]\n";
    ir += "  %data = phi i8** [ %init_data, %entry ], [ %final_data, %store ]\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %body, label %done\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %col_count = call i32 @sqlite3_column_count(i8* %stmt)\n";
    // Build a struct of i8* fields instead of a pipe-delimited string
    ir += "  %row_struct = call i8* @__sqlite_row_to_struct(i8* %stmt, i32 %col_count)\n";
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
    ir += "  %final_data = phi i8** [ %data, %body ], [ %new_data, %grow ]\n";
    ir += "  %final_cap = phi i32 [ %cap, %body ], [ %new_cap, %grow ]\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n";
    ir += "  store i8* %row_struct, i8** %elem_ptr\n";
    ir += "  %new_len = add i32 %len, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  %arr_raw = call i8* @GC_malloc(i64 24)\n";
    ir += "  %arr = bitcast i8* %arr_raw to %ObjectArray*\n";
    // ObjectArray.data is i8* (opaque), so bitcast i8** → i8*
    ir += "  %data_i8 = bitcast i8** %data to i8*\n";
    ir += "  %f0 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 0\n";
    ir += "  store i8* %data_i8, i8** %f0\n";
    ir += "  %f1 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 1\n";
    ir += "  store i32 %len, i32* %f1\n";
    ir += "  %f2 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 2\n";
    ir += "  store i32 %cap, i32* %f2\n";
    ir += "  ret %ObjectArray* %arr\n";
    ir += "}\n\n";
    return ir;
  }

  // Same as @__sqlite_query but with parameter binding. Mirrors @__sqlite_all_params.
  generateSqliteQueryWithParamsHelper(): string {
    let ir = "";
    ir +=
      "define %ObjectArray* @__sqlite_query_params(i8* %db, i8* %sql, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n";
    ir += "  %init_data_raw = call i8* @GC_malloc(i64 512)\n";
    ir += "  %init_data = bitcast i8* %init_data_raw to i8**\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %len = phi i32 [ 0, %entry ], [ %new_len, %store ]\n";
    ir += "  %cap = phi i32 [ 64, %entry ], [ %final_cap, %store ]\n";
    ir += "  %data = phi i8** [ %init_data, %entry ], [ %final_data, %store ]\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %body, label %done\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %col_count_qp = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %row_struct = call i8* @__sqlite_row_to_struct(i8* %stmt, i32 %col_count_qp)\n";
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
    ir += "  %final_data = phi i8** [ %data, %body ], [ %new_data, %grow ]\n";
    ir += "  %final_cap = phi i32 [ %cap, %body ], [ %new_cap, %grow ]\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n";
    ir += "  store i8* %row_struct, i8** %elem_ptr\n";
    ir += "  %new_len = add i32 %len, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  %arr_raw = call i8* @GC_malloc(i64 24)\n";
    ir += "  %arr = bitcast i8* %arr_raw to %ObjectArray*\n";
    ir += "  %data_i8 = bitcast i8** %data to i8*\n";
    ir += "  %f0 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 0\n";
    ir += "  store i8* %data_i8, i8** %f0\n";
    ir += "  %f1 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 1\n";
    ir += "  store i32 %len, i32* %f1\n";
    ir += "  %f2 = getelementptr inbounds %ObjectArray, %ObjectArray* %arr, i32 0, i32 2\n";
    ir += "  store i32 %cap, i32* %f2\n";
    ir += "  ret %ObjectArray* %arr\n";
    ir += "}\n\n";
    return ir;
  }

  // Returns null for no row, otherwise a struct of i8* fields (same layout as __sqlite_row_to_struct).
  generateSqliteGetRowHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_get_row(i8* %db, i8* %sql) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %has_row, label %no_row\n";
    ir += "\n";
    ir += "has_row:\n";
    ir += "  %col_count = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %result = call i8* @__sqlite_row_to_struct(i8* %stmt, i32 %col_count)\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* %result\n";
    ir += "\n";
    ir += "no_row:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* null\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteGetRowWithParamsHelper(): string {
    let ir = "";
    ir += "define i8* @__sqlite_get_row_params(i8* %db, i8* %sql, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %has_row, label %no_row\n";
    ir += "\n";
    ir += "has_row:\n";
    ir += "  %col_count_grp = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %result = call i8* @__sqlite_row_to_struct(i8* %stmt, i32 %col_count_grp)\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* %result\n";
    ir += "\n";
    ir += "no_row:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
    ir += "  ret i8* null\n";
    ir += "}\n\n";
    return ir;
  }

  generateSqliteAllWithParamsHelper(): string {
    let ir = "";
    ir += "define %StringArray* @__sqlite_all_params(i8* %db, i8* %sql, %StringArray* %params) {\n";
    ir += "entry:\n";
    ir += "  %sql_len = call i64 @strlen(i8* %sql)\n";
    ir += "  %sql_len_i32 = trunc i64 %sql_len to i32\n";
    ir += "  %stmt_ptr_raw = call i8* @GC_malloc(i64 8)\n";
    ir += "  %stmt_ptr = bitcast i8* %stmt_ptr_raw to i8**\n";
    ir +=
      "  %rc = call i32 @sqlite3_prepare_v2(i8* %db, i8* %sql, i32 %sql_len_i32, i8** %stmt_ptr, i8** null)\n";
    ir += "  %stmt = load i8*, i8** %stmt_ptr\n";
    ir += "  call void @__sqlite_bind_params(i8* %stmt, %StringArray* %params)\n";
    ir += "  %init_data_raw = call i8* @GC_malloc(i64 512)\n";
    ir += "  %init_data = bitcast i8* %init_data_raw to i8**\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %len = phi i32 [ 0, %entry ], [ %new_len, %store ]\n";
    ir += "  %cap = phi i32 [ 64, %entry ], [ %final_cap, %store ]\n";
    ir += "  %data = phi i8** [ %init_data, %entry ], [ %final_data, %store ]\n";
    ir += "  %step_rc = call i32 @sqlite3_step(i8* %stmt)\n";
    ir += "  %is_row = icmp eq i32 %step_rc, 100\n";
    ir += "  br i1 %is_row, label %body, label %done\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %col_count_ap = call i32 @sqlite3_column_count(i8* %stmt)\n";
    ir += "  %text_copy = call i8* @__sqlite_row_to_string(i8* %stmt, i32 %col_count_ap)\n";
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
    ir += "  %final_data = phi i8** [ %data, %body ], [ %new_data, %grow ]\n";
    ir += "  %final_cap = phi i32 [ %cap, %body ], [ %new_cap, %grow ]\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %elem_ptr = getelementptr inbounds i8*, i8** %final_data, i64 %len_i64\n";
    ir += "  store i8* %text_copy, i8** %elem_ptr\n";
    ir += "  %new_len = add i32 %len, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  call i32 @sqlite3_finalize(i8* %stmt)\n";
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
}

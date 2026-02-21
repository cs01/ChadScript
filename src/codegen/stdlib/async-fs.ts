export class AsyncFsGenerator {
  generateTypes(): string {
    let ir = "";
    ir += "%FsWorkContext = type { i8*, i8*, i8*, %Promise* }\n\n";
    ir += '@.async_fs_mode_r = private unnamed_addr constant [2 x i8] c"r\\00"\n';
    ir += '@.async_fs_mode_w = private unnamed_addr constant [2 x i8] c"w\\00"\n';
    ir += '@.async_fs_mode_a = private unnamed_addr constant [2 x i8] c"a\\00"\n';
    ir += '@.async_fs_mkdir_fmt = private unnamed_addr constant [12 x i8] c"mkdir -p %s\\00"\n\n';
    return ir;
  }

  generateAfterWorkCb(): string {
    let ir = "";
    ir += "define void @__fs_after_work_cb(%struct.uv_work_s* %req, i32 %status) {\n";
    ir += "entry:\n";
    ir += "  %req_i8 = bitcast %struct.uv_work_s* %req to i8*\n";
    ir += "  %data = call i8* @uv_req_get_data(i8* %req_i8)\n";
    ir += "  %ctx = bitcast i8* %data to %FsWorkContext*\n";
    ir +=
      "  %result_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  %result = load i8*, i8** %result_ptr\n";
    ir +=
      "  %promise_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 3\n";
    ir += "  %promise = load %Promise*, %Promise** %promise_ptr\n";
    ir += "  call void @__Promise_resolve(%Promise* %promise, i8* %result)\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  private generateAsyncEntry(name: string, workCbName: string, argCount: number): string {
    let ir = "";
    if (argCount === 1) {
      ir += `define %Promise* @${name}(i8* %arg1) {\n`;
    } else {
      ir += `define %Promise* @${name}(i8* %arg1, i8* %arg2) {\n`;
    }
    ir += "entry:\n";
    ir += "  %promise = call %Promise* @__Promise_new()\n";
    ir += "  %ctx_mem = call i8* @GC_malloc(i64 32)\n";
    ir += "  %ctx = bitcast i8* %ctx_mem to %FsWorkContext*\n";
    ir +=
      "  %arg1_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  store i8* %arg1, i8** %arg1_ptr\n";
    ir +=
      "  %arg2_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 1\n";
    if (argCount === 2) {
      ir += "  store i8* %arg2, i8** %arg2_ptr\n";
    } else {
      ir += "  store i8* null, i8** %arg2_ptr\n";
    }
    ir +=
      "  %result_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  store i8* null, i8** %result_ptr\n";
    ir +=
      "  %promise_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 3\n";
    ir += "  store %Promise* %promise, %Promise** %promise_ptr\n";
    ir += "  %req_mem = call i8* @GC_malloc(i64 128)\n";
    ir += "  %req = bitcast i8* %req_mem to %struct.uv_work_s*\n";
    ir += "  call void @uv_req_set_data(i8* %req_mem, i8* %ctx_mem)\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir += `  call i32 @uv_queue_work(%struct.uv_loop_s* %loop, %struct.uv_work_s* %req, void (%struct.uv_work_s*)* @${workCbName}, void (%struct.uv_work_s*, i32)* @__fs_after_work_cb)\n`;
    ir += "  ret %Promise* %promise\n";
    ir += "}\n\n";
    return ir;
  }

  private generateWorkCbPreamble(): string {
    let ir = "";
    ir += "  %req_i8 = bitcast %struct.uv_work_s* %req to i8*\n";
    ir += "  %data = call i8* @uv_req_get_data(i8* %req_i8)\n";
    ir += "  %ctx = bitcast i8* %data to %FsWorkContext*\n";
    ir +=
      "  %arg1_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  %arg1 = load i8*, i8** %arg1_ptr\n";
    return ir;
  }

  private generateWorkCbLoadArg2(): string {
    let ir = "";
    ir +=
      "  %arg2_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 1\n";
    ir += "  %arg2 = load i8*, i8** %arg2_ptr\n";
    return ir;
  }

  private generateWorkCbStoreResult(resultReg: string): string {
    let ir = "";
    ir +=
      "  %result_ptr = getelementptr inbounds %FsWorkContext, %FsWorkContext* %ctx, i32 0, i32 2\n";
    ir += `  store i8* ${resultReg}, i8** %result_ptr\n`;
    return ir;
  }

  generateReadFile(): string {
    let ir = "";

    ir += "define i8* @__fs_readFile_helper(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %mode = getelementptr inbounds [2 x i8], [2 x i8]* @.async_fs_mode_r, i32 0, i32 0\n";
    ir += "  %fp = call i8* @fopen(i8* %path, i8* %mode)\n";
    ir += "  %is_null = icmp eq i8* %fp, null\n";
    ir += "  br i1 %is_null, label %fail, label %success\n\n";
    ir += "fail:\n";
    ir += "  %empty = call i8* @GC_malloc_atomic(i64 1)\n";
    ir += "  store i8 0, i8* %empty\n";
    ir += "  ret i8* %empty\n\n";
    ir += "success:\n";
    ir += "  %seek1 = call i32 @fseek(i8* %fp, i64 0, i32 2)\n";
    ir += "  %size = call i64 @ftell(i8* %fp)\n";
    ir += "  %seek2 = call i32 @fseek(i8* %fp, i64 0, i32 0)\n";
    ir += "  %buf_size = add i64 %size, 1\n";
    ir += "  %buf = call i8* @GC_malloc_atomic(i64 %buf_size)\n";
    ir += "  %bytes = call i64 @fread(i8* %buf, i64 1, i64 %size, i8* %fp)\n";
    ir += "  %null_pos = getelementptr inbounds i8, i8* %buf, i64 %size\n";
    ir += "  store i8 0, i8* %null_pos\n";
    ir += "  %close = call i32 @fclose(i8* %fp)\n";
    ir += "  ret i8* %buf\n";
    ir += "}\n\n";

    ir += "define void @__fs_readFile_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += "  %result = call i8* @__fs_readFile_helper(i8* %arg1)\n";
    ir += this.generateWorkCbStoreResult("%result");
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_readFile_async", "__fs_readFile_work_cb", 1);
    return ir;
  }

  generateWriteFile(): string {
    let ir = "";

    ir += "define void @__fs_writeFile_helper(i8* %path, i8* %content) {\n";
    ir += "entry:\n";
    ir += "  %mode = getelementptr inbounds [2 x i8], [2 x i8]* @.async_fs_mode_w, i32 0, i32 0\n";
    ir += "  %fp = call i8* @fopen(i8* %path, i8* %mode)\n";
    ir += "  %is_null = icmp eq i8* %fp, null\n";
    ir += "  br i1 %is_null, label %done, label %write\n\n";
    ir += "write:\n";
    ir += "  %len = call i64 @strlen(i8* %content)\n";
    ir += "  %bytes = call i64 @fwrite(i8* %content, i64 1, i64 %len, i8* %fp)\n";
    ir += "  %close = call i32 @fclose(i8* %fp)\n";
    ir += "  br label %done\n\n";
    ir += "done:\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += "define void @__fs_writeFile_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += this.generateWorkCbLoadArg2();
    ir += "  call void @__fs_writeFile_helper(i8* %arg1, i8* %arg2)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_writeFile_async", "__fs_writeFile_work_cb", 2);
    return ir;
  }

  generateAppendFile(): string {
    let ir = "";

    ir += "define void @__fs_appendFile_helper(i8* %path, i8* %content) {\n";
    ir += "entry:\n";
    ir += "  %mode = getelementptr inbounds [2 x i8], [2 x i8]* @.async_fs_mode_a, i32 0, i32 0\n";
    ir += "  %fp = call i8* @fopen(i8* %path, i8* %mode)\n";
    ir += "  %is_null = icmp eq i8* %fp, null\n";
    ir += "  br i1 %is_null, label %done, label %write\n\n";
    ir += "write:\n";
    ir += "  %len = call i64 @strlen(i8* %content)\n";
    ir += "  %bytes = call i64 @fwrite(i8* %content, i64 1, i64 %len, i8* %fp)\n";
    ir += "  %close = call i32 @fclose(i8* %fp)\n";
    ir += "  br label %done\n\n";
    ir += "done:\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += "define void @__fs_appendFile_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += this.generateWorkCbLoadArg2();
    ir += "  call void @__fs_appendFile_helper(i8* %arg1, i8* %arg2)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_appendFile_async", "__fs_appendFile_work_cb", 2);
    return ir;
  }

  generateReaddir(): string {
    let ir = "";

    ir += "define void @__fs_readdir_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += "  %arr = call %StringArray* @__fs_readdirSync(i8* %arg1)\n";
    ir += "  %arr_i8 = bitcast %StringArray* %arr to i8*\n";
    ir += this.generateWorkCbStoreResult("%arr_i8");
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_readdir_async", "__fs_readdir_work_cb", 1);
    return ir;
  }

  generateStat(): string {
    let ir = "";

    ir += "define void @__fs_stat_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += "  %stat_result = call i8* @__fs_statSync(i8* %arg1)\n";
    ir += this.generateWorkCbStoreResult("%stat_result");
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_stat_async", "__fs_stat_work_cb", 1);
    return ir;
  }

  generateUnlink(): string {
    let ir = "";

    ir += "define void @__fs_unlink_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += "  %rc = call i32 @unlink(i8* %arg1)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_unlink_async", "__fs_unlink_work_cb", 1);
    return ir;
  }

  generateMkdir(): string {
    let ir = "";

    ir += "define void @__fs_mkdir_helper(i8* %path) {\n";
    ir += "entry:\n";
    ir += "  %buf = call i8* @GC_malloc(i64 4096)\n";
    ir +=
      "  %fmt = getelementptr inbounds [12 x i8], [12 x i8]* @.async_fs_mkdir_fmt, i32 0, i32 0\n";
    ir +=
      "  %written = call i32 (i8*, i64, i8*, ...) @snprintf(i8* %buf, i64 4096, i8* %fmt, i8* %path)\n";
    ir += "  %rc = call i32 @system(i8* %buf)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += "define void @__fs_mkdir_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += "  call void @__fs_mkdir_helper(i8* %arg1)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_mkdir_async", "__fs_mkdir_work_cb", 1);
    return ir;
  }

  generateRename(): string {
    let ir = "";

    ir += "define void @__fs_rename_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += this.generateWorkCbLoadArg2();
    ir += "  %rc = call i32 @rename(i8* %arg1, i8* %arg2)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_rename_async", "__fs_rename_work_cb", 2);
    return ir;
  }

  generateCopyFile(): string {
    let ir = "";

    ir += "define void @__fs_copyFile_helper(i8* %src, i8* %dest) {\n";
    ir += "entry:\n";
    ir +=
      "  %src_mode = getelementptr inbounds [2 x i8], [2 x i8]* @.async_fs_mode_r, i32 0, i32 0\n";
    ir += "  %src_fp = call i8* @fopen(i8* %src, i8* %src_mode)\n";
    ir += "  %src_null = icmp eq i8* %src_fp, null\n";
    ir += "  br i1 %src_null, label %done, label %read\n\n";
    ir += "read:\n";
    ir += "  %seek1 = call i32 @fseek(i8* %src_fp, i64 0, i32 2)\n";
    ir += "  %size = call i64 @ftell(i8* %src_fp)\n";
    ir += "  %seek2 = call i32 @fseek(i8* %src_fp, i64 0, i32 0)\n";
    ir += "  %buf = call i8* @GC_malloc_atomic(i64 %size)\n";
    ir += "  %bytes_r = call i64 @fread(i8* %buf, i64 1, i64 %size, i8* %src_fp)\n";
    ir += "  %close_src = call i32 @fclose(i8* %src_fp)\n";
    ir +=
      "  %dest_mode = getelementptr inbounds [2 x i8], [2 x i8]* @.async_fs_mode_w, i32 0, i32 0\n";
    ir += "  %dest_fp = call i8* @fopen(i8* %dest, i8* %dest_mode)\n";
    ir += "  %bytes_w = call i64 @fwrite(i8* %buf, i64 1, i64 %size, i8* %dest_fp)\n";
    ir += "  %close_dest = call i32 @fclose(i8* %dest_fp)\n";
    ir += "  br label %done\n\n";
    ir += "done:\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += "define void @__fs_copyFile_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += this.generateWorkCbPreamble();
    ir += this.generateWorkCbLoadArg2();
    ir += "  call void @__fs_copyFile_helper(i8* %arg1, i8* %arg2)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += this.generateAsyncEntry("__fs_copyFile_async", "__fs_copyFile_work_cb", 2);
    return ir;
  }

  generateAll(): string {
    let ir = "\n";
    ir += this.generateTypes();
    ir += this.generateAfterWorkCb();
    ir += this.generateReadFile();
    ir += this.generateWriteFile();
    ir += this.generateAppendFile();
    ir += this.generateReaddir();
    ir += this.generateStat();
    ir += this.generateUnlink();
    ir += this.generateMkdir();
    ir += this.generateRename();
    ir += this.generateCopyFile();
    return ir;
  }
}

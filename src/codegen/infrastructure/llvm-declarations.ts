export interface DeclConfig {
  curl?: boolean;
  crypto?: boolean;
  sqlite?: boolean;
  testRunner?: boolean;
  targetOS?: string;
}

export function getLLVMDeclarations(config?: DeclConfig): string {
  let ir = "";

  ir += "%Array = type { double*, i32, i32 }\n";
  ir += "%ObjectArray = type { i8*, i32, i32 }\n";
  ir += "%StringArray = type { i8**, i32, i32 }\n";
  ir += "%Uint8Array = type { i8*, i32, i32 }\n";
  ir += "%Map = type { double*, double*, i32, i32 }\n";
  ir += "%StringMap = type { i8**, i8**, i32, i32 }\n";
  ir += "%Set = type { double*, i32, i32 }\n";
  ir += "%StringSet = type { i8**, i32, i32 }\n";
  ir += "%struct.timeval = type { i64, i64 }\n";
  ir += "%Date = type { double }\n";
  ir += "%struct.tm = type { i32, i32, i32, i32, i32, i32, i32, i32, i32, i64, i8* }\n";
  ir += "%ExceptionFrame = type { [200 x i8], i8*, i8* }\n\n";

  ir += "declare i8* @malloc(i64)\n";
  ir += "declare i8* @calloc(i64, i64)\n";
  ir += "declare void @free(i8*)\n";

  ir += "; Boehm GC - automatic garbage collection\n";
  ir += "declare void @GC_init()\n";
  ir += "declare noalias i8* @GC_malloc(i64)\n";
  ir += "declare noalias i8* @GC_malloc_atomic(i64)\n";
  ir += "declare noalias i8* @GC_malloc_uncollectable(i64)\n";
  ir += "declare i8* @GC_realloc(i8*, i64)\n";
  ir += "declare void @GC_disable()\n";
  ir += "declare void @GC_enable()\n";
  ir += "declare i8* @strcpy(i8*, i8*)\n";
  ir += "declare i8* @strncpy(i8*, i8*, i64)\n";
  ir += "declare i8* @strcat(i8*, i8*)\n";
  ir += "declare i8* @strdup(i8*)\n";
  ir += "declare i64 @strlen(i8*)\n";
  ir += "declare i32 @strcmp(i8*, i8*)\n";
  ir += "declare i32 @strncmp(i8*, i8*, i64)\n";
  ir += "declare i32 @snprintf(i8*, i64, i8*, ...)\n";
  ir += "declare i64 @strtol(i8*, i8**, i32)\n";
  ir += "declare double @strtod(i8*, i8**)\n";
  ir += "declare i8* @strstr(i8*, i8*)\n";
  ir += "declare i8* @strrchr(i8*, i32)\n";
  ir += "declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n";
  ir += "declare void @llvm.memmove.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n";
  ir += "declare void @llvm.memset.p0i8.i64(i8*, i8, i64, i1)\n";
  ir += "declare void @qsort(i8*, i64, i64, i32 (i8*, i8*)*)\n";
  ir += "\n";

  ir += "declare double @llvm.sqrt.f64(double)\n";
  ir += "declare double @llvm.pow.f64(double, double)\n";
  ir += "declare double @llvm.floor.f64(double)\n";
  ir += "declare double @llvm.ceil.f64(double)\n";
  ir += "declare double @llvm.round.f64(double)\n";
  ir += "declare double @llvm.trunc.f64(double)\n";
  ir += "declare double @llvm.fabs.f64(double)\n";
  ir += "declare double @llvm.log.f64(double)\n";
  ir += "declare double @llvm.sin.f64(double)\n";
  ir += "declare double @llvm.cos.f64(double)\n";
  ir += "declare double @drand48()\n";
  ir += "declare void @srand48(i64)\n";
  ir += "declare i64 @time(i8*)\n";
  ir += "declare double @llvm.maxnum.f64(double, double)\n";
  ir += "declare double @llvm.minnum.f64(double, double)\n";
  ir += "\n";

  ir += "declare i8* @cs_regex_alloc()\n";
  ir += "declare i32 @cs_regex_compile(i8*, i8*, i32)\n";
  ir += "declare i8* @cs_pmatch_alloc(i32)\n";
  ir += "declare i32 @cs_regex_exec(i8*, i8*, i32, i8*, i32)\n";
  ir += "declare i64 @cs_pmatch_start(i8*, i32)\n";
  ir += "declare i64 @cs_pmatch_end(i8*, i32)\n";
  ir += "declare void @cs_regex_free(i8*)\n";
  ir += "\n";

  // child_process bridge — %SpawnSyncResult = { stdout: i8*, stderr: i8*, status: double }
  ir += "%SpawnSyncResult = type { i8*, i8*, double }\n";
  ir += "declare i8* @cs_execSync(i8*)\n";
  ir += "declare i8* @cs_spawnSync(i8*, i8**, i32)\n";
  // cs_spawn: async spawn with streaming callbacks (stdout_cb, stderr_cb, exit_cb)
  ir += "declare void @cs_spawn(i8*, i8**, i32, void (i8*)*, void (i8*)*, void (double)*)\n";
  ir += "\n";

  ir += "declare i32 @printf(i8*, ...)\n";
  ir += "declare i32 @fprintf(i8*, i8*, ...)\n";
  const isMac =
    config && config.targetOS ? config.targetOS === "darwin" : process.platform === "darwin";
  if (isMac) {
    ir += "@__stderrp = external global i8*\n";
    ir += "@stderr = internal global i8* null\n";
  } else {
    ir += "@stderr = external global i8*\n";
  }
  ir += "\n";

  ir += "declare void @exit(i32) noreturn\n";
  ir += "declare i32 @setjmp(i8*) returns_twice\n";
  ir += "declare void @longjmp(i8*, i32) noreturn\n";
  ir += "declare i32 @fflush(i8*)\n";
  if (isMac) {
    ir += "@__stdoutp = external global i8*\n";
    ir += "@stdout = internal global i8* null\n";
  } else {
    ir += "@stdout = external global i8*\n";
  }
  ir += "\n";

  ir += "; Console format strings for inline console.log\n";
  ir += '@.str.newline = private unnamed_addr constant [2 x i8] c"\\0A\\00", align 1\n';
  ir += '@.str.strfmt = private unnamed_addr constant [4 x i8] c"%s\\0A\\00", align 1\n';
  ir += '@.str.numfmt = private unnamed_addr constant [7 x i8] c"%.15g\\0A\\00", align 1\n';
  ir += '@.str.strfmt_no_nl = private unnamed_addr constant [3 x i8] c"%s\\00", align 1\n';
  ir += '@.str.numfmt_no_nl = private unnamed_addr constant [6 x i8] c"%.15g\\00", align 1\n';
  ir += '@.str.space = private unnamed_addr constant [2 x i8] c" \\00", align 1\n';
  ir += '@.str.hello = private unnamed_addr constant [7 x i8] c"Hello\\0A\\00", align 1\n';
  ir += '@.str.throw_fmt = private constant [11 x i8] c"Error: %s\\0A\\00"\n';
  ir += '@.str.popen_mode = private unnamed_addr constant [2 x i8] c"r\\00", align 1\n';
  ir += "\n";

  ir += "declare i8* @fopen(i8*, i8*)\n";
  ir += "declare i32 @fclose(i8*)\n";
  ir += "declare i64 @fread(i8*, i64, i64, i8*)\n";
  ir += "declare i64 @fwrite(i8*, i64, i64, i8*)\n";
  ir += "declare i32 @fseek(i8*, i64, i32)\n";
  ir += "declare i64 @ftell(i8*)\n";
  ir += "declare i32 @unlink(i8*)\n";
  ir += "declare i32 @rename(i8*, i8*)\n";
  ir += "declare i8* @opendir(i8*)\n";
  ir += "declare i8* @readdir(i8*)\n";
  ir += "declare i32 @closedir(i8*)\n";
  ir += "declare i32 @stat(i8*, i8*)\n";
  ir += "declare i32 @lstat(i8*, i8*)\n";
  ir += "\n";

  ir += "declare i32 @socket(i32, i32, i32)\n";
  ir += "declare i32 @close(i32)\n";
  ir += "declare i32 @bind(i32, i8*, i32)\n";
  ir += "declare i32 @listen(i32, i32)\n";
  ir += "declare i32 @accept(i32, i8*, i32*)\n";
  ir += "declare i32 @connect(i32, i8*, i32)\n";
  ir += "declare i64 @read(i32, i8*, i64)\n";
  ir += "declare i64 @write(i32, i8*, i64)\n";
  ir += "\n";

  ir += "declare i8* @realpath(i8*, i8*)\n";
  ir += "declare i8* @dirname(i8*)\n";
  ir += "declare i8* @basename(i8*)\n";
  ir += "\n";

  ir += "; Process-related syscalls\n";
  ir += "declare i8* @getenv(i8*)\n";
  ir += "declare i8* @getcwd(i8*, i64)\n";
  ir += "declare i32 @getpid()\n";
  ir += "declare i32 @getppid()\n";
  ir += "declare i32 @getuid()\n";
  ir += "declare i32 @getgid()\n";
  ir += "declare i32 @geteuid()\n";
  ir += "declare i32 @getegid()\n";
  ir += "declare i32 @chdir(i8*)\n";
  ir += "declare void @abort()\n";
  ir += "declare i32 @kill(i32, i32)\n";
  ir += "declare i64 @uv_hrtime()\n";
  ir += "declare i32 @isatty(i32)\n";
  ir += "declare i32 @gethostname(i8*, i64)\n";
  ir += "declare i64 @sysconf(i32)\n";
  ir += "declare double @atof(i8*)\n";
  // os-bridge.c — platform-abstracted os helpers
  ir += "declare i64 @chad_os_freemem()\n";
  ir += "declare double @chad_os_uptime()\n";
  // dotenv-bridge.c — auto-loads .env at startup
  ir += "declare void @cs_load_dotenv()\n";
  ir += "\n";

  ir += "declare i32 @system(i8*)\n";
  ir += "declare i8* @popen(i8*, i8*)\n";
  ir += "declare i32 @pclose(i8*)\n";
  ir += "\n";

  ir += "declare i32 @sprintf(i8*, i8*, ...)\n";
  ir += "declare i32 @gettimeofday(%struct.timeval*, i8*)\n";
  ir += "declare %struct.tm* @localtime_r(i64*, %struct.tm*)\n";
  ir += "declare %struct.tm* @gmtime_r(i64*, %struct.tm*)\n";
  ir += "declare i64 @strftime(i8*, i64, i8*, %struct.tm*)\n";
  ir += "\n";

  if (config && config.curl) {
    ir += "; libcurl functions\n";
    ir += "declare i8* @curl_easy_init()\n";
    ir += "declare i32 @curl_easy_setopt(i8*, i32, ...)\n";
    ir += "declare i32 @curl_easy_perform(i8*)\n";
    ir += "declare void @curl_easy_cleanup(i8*)\n";
    ir += "declare i8* @curl_easy_strerror(i32)\n";
    ir += "\n";

    ir += "@CURLOPT_URL = constant i32 10002\n";
    ir += "@CURLOPT_WRITEFUNCTION = constant i32 20011\n";
    ir += "@CURLOPT_WRITEDATA = constant i32 10001\n";
    ir += "@CURLOPT_FOLLOWLOCATION = constant i32 52\n";
    ir += "@CURLOPT_USERAGENT = constant i32 10018\n";
    ir += "@CURLOPT_HEADERFUNCTION = constant i32 20079\n";
    ir += "@CURLOPT_HEADERDATA = constant i32 10029\n";
    ir += "@CURLINFO_EFFECTIVE_URL = constant i32 1048577\n";
    ir += "@CURLINFO_REDIRECT_COUNT = constant i32 2097172\n";
    ir += "\n";
  }

  if (config && config.crypto) {
    ir += "; OpenSSL EVP functions (crypto module)\n";
    ir += "declare i8* @EVP_MD_CTX_new()\n";
    ir += "declare void @EVP_MD_CTX_free(i8*)\n";
    ir += "declare i32 @EVP_DigestInit_ex(i8*, i8*, i8*)\n";
    ir += "declare i32 @EVP_DigestUpdate(i8*, i8*, i64)\n";
    ir += "declare i32 @EVP_DigestFinal_ex(i8*, i8*, i32*)\n";
    ir += "declare i8* @EVP_sha256()\n";
    ir += "declare i8* @EVP_md5()\n";
    ir += "declare i8* @EVP_sha512()\n";
    ir += "declare i32 @RAND_bytes(i8*, i32)\n";
    ir += "\n";
  }

  if (config && config.sqlite) {
    ir += "; SQLite3 functions (sqlite module)\n";
    ir += "declare i32 @sqlite3_open(i8*, i8**)\n";
    ir += "declare i32 @sqlite3_exec(i8*, i8*, i8*, i8*, i8**)\n";
    ir += "declare i32 @sqlite3_close(i8*)\n";
    ir += "declare i32 @sqlite3_prepare_v2(i8*, i8*, i32, i8**, i8**)\n";
    ir += "declare i32 @sqlite3_step(i8*)\n";
    ir += "declare i8* @sqlite3_column_text(i8*, i32)\n";
    ir += "declare i32 @sqlite3_column_count(i8*)\n";
    ir += "declare i32 @sqlite3_finalize(i8*)\n";
    ir += "declare i32 @sqlite3_bind_text(i8*, i32, i8*, i32, i64)\n";
    ir += "\n";
  }

  if (config && config.testRunner) {
    ir += "; Test runner format strings\n";
    ir +=
      '@.str.test_pass = private unnamed_addr constant [12 x i8] c"  PASS: %s\\0A\\00", align 1\n';
    ir +=
      '@.str.test_fail = private unnamed_addr constant [12 x i8] c"  FAIL: %s\\0A\\00", align 1\n';
    ir +=
      '@.str.test_summary = private unnamed_addr constant [39 x i8] c"\\0A%d passed, %d failed (%d total) %dms\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_eq_num = private unnamed_addr constant [31 x i8] c"    expected %.15g, got %.15g\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_eq_str = private unnamed_addr constant [25 x i8] c"    expected %s, got %s\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_fail_msg = private unnamed_addr constant [8 x i8] c"    %s\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_falsy = private unnamed_addr constant [20 x i8] c"    value is falsy\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_deep_len = private unnamed_addr constant [39 x i8] c"    expected length %d, got length %d\\0A\\00", align 1\n';
    ir +=
      '@.str.assert_deep_idx = private unnamed_addr constant [31 x i8] c"    arrays differ at index %d\\0A\\00", align 1\n';
    ir += '@.str.describe_header = private unnamed_addr constant [4 x i8] c"%s\\0A\\00", align 1\n';
    ir += '@.str.indent_unit = private unnamed_addr constant [3 x i8] c"  \\00", align 1\n';
    ir += "\n";
  }

  return ir;
}

export function getSafeStringHelper(): string {
  let ir = "";
  ir += "; Return empty string if pointer is NULL, otherwise return the pointer\n";
  ir += "define i8* @__safe_string(i8* %str) {\n";
  ir += "entry:\n";
  ir += "  %is_null = icmp eq i8* %str, null\n";
  ir += "  br i1 %is_null, label %return_empty, label %return_str\n";
  ir += "\n";
  ir += "return_empty:\n";
  ir += "  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n";
  ir += "\n";
  ir += "return_str:\n";
  ir += "  ret i8* %str\n";
  ir += "}\n";
  ir += "\n";
  ir += '@.empty_str = private unnamed_addr constant [1 x i8] c"\\00", align 1\n';
  ir += "\n";
  return ir;
}

export function getStringHashHelper(): string {
  let ir = "";
  ir += "; DJB2 hash function for strings\n";
  ir += "define i32 @__string_hash(i8* %str) {\n";
  ir += "entry:\n";
  ir += "  %is_null = icmp eq i8* %str, null\n";
  ir += "  br i1 %is_null, label %ret_zero, label %loop\n";
  ir += "ret_zero:\n";
  ir += "  ret i32 0\n";
  ir += "loop:\n";
  ir += "  %idx = phi i64 [ 0, %entry ], [ %next_idx, %loop_body ]\n";
  ir += "  %hash = phi i32 [ 5381, %entry ], [ %new_hash, %loop_body ]\n";
  ir += "  %char_ptr = getelementptr inbounds i8, i8* %str, i64 %idx\n";
  ir += "  %char = load i8, i8* %char_ptr\n";
  ir += "  %is_end = icmp eq i8 %char, 0\n";
  ir += "  br i1 %is_end, label %done, label %loop_body\n";
  ir += "loop_body:\n";
  ir += "  %char_i32 = zext i8 %char to i32\n";
  ir += "  %hash_shl = shl i32 %hash, 5\n";
  ir += "  %hash_plus = add i32 %hash_shl, %hash\n";
  ir += "  %new_hash = add i32 %hash_plus, %char_i32\n";
  ir += "  %next_idx = add i64 %idx, 1\n";
  ir += "  br label %loop\n";
  ir += "done:\n";
  ir += "  ret i32 %hash\n";
  ir += "}\n\n";
  ir += "; Rehash all entries from old arrays into new hash table arrays\n";
  ir +=
    "define void @__strmap_rehash(i8** %old_keys, i8** %old_values, i32 %old_cap, i8** %new_keys, i8** %new_values, i32 %new_cap) {\n";
  ir += "entry:\n";
  ir += "  br label %loop\n";
  ir += "loop:\n";
  ir += "  %i = phi i32 [ 0, %entry ], [ %next_i, %loop_next ]\n";
  ir += "  %cmp = icmp slt i32 %i, %old_cap\n";
  ir += "  br i1 %cmp, label %body, label %done\n";
  ir += "body:\n";
  ir += "  %key_ptr = getelementptr inbounds i8*, i8** %old_keys, i32 %i\n";
  ir += "  %key = load i8*, i8** %key_ptr\n";
  ir += "  %is_null = icmp eq i8* %key, null\n";
  ir += "  br i1 %is_null, label %loop_next, label %insert\n";
  ir += "insert:\n";
  ir += "  %val_ptr = getelementptr inbounds i8*, i8** %old_values, i32 %i\n";
  ir += "  %val = load i8*, i8** %val_ptr\n";
  ir += "  %hash = call i32 @__string_hash(i8* %key)\n";
  ir += "  %mask = sub i32 %new_cap, 1\n";
  ir += "  %slot0 = and i32 %hash, %mask\n";
  ir += "  br label %probe\n";
  ir += "probe:\n";
  ir += "  %slot = phi i32 [ %slot0, %insert ], [ %next_slot, %probe_next ]\n";
  ir += "  %dest_key_ptr = getelementptr inbounds i8*, i8** %new_keys, i32 %slot\n";
  ir += "  %dest_key = load i8*, i8** %dest_key_ptr\n";
  ir += "  %is_empty = icmp eq i8* %dest_key, null\n";
  ir += "  br i1 %is_empty, label %place, label %probe_next\n";
  ir += "place:\n";
  ir += "  store i8* %key, i8** %dest_key_ptr\n";
  ir += "  %dest_val_ptr = getelementptr inbounds i8*, i8** %new_values, i32 %slot\n";
  ir += "  store i8* %val, i8** %dest_val_ptr\n";
  ir += "  br label %loop_next\n";
  ir += "probe_next:\n";
  ir += "  %slot_plus = add i32 %slot, 1\n";
  ir += "  %next_slot = and i32 %slot_plus, %mask\n";
  ir += "  br label %probe\n";
  ir += "loop_next:\n";
  ir += "  %next_i = add i32 %i, 1\n";
  ir += "  br label %loop\n";
  ir += "done:\n";
  ir += "  ret void\n";
  ir += "}\n\n";
  return ir;
}

export function getDoubleToStringHelper(): string {
  let ir = "";
  ir += "; Convert a double to its string representation\n";
  ir += '@.double_fmt = private unnamed_addr constant [6 x i8] c"%.15g\\00", align 1\n';
  ir += "\n";
  ir += "define i8* @__double_to_string(double %val) {\n";
  ir += "entry:\n";
  ir += "  %buffer = call i8* @GC_malloc_atomic(i64 48)\n";
  ir += "  %fmt = getelementptr inbounds [6 x i8], [6 x i8]* @.double_fmt, i64 0, i64 0\n";
  ir += "  call i32 (i8*, i64, i8*, ...) @snprintf(i8* %buffer, i64 48, i8* %fmt, double %val)\n";
  ir += "  ret i8* %buffer\n";
  ir += "}\n";
  ir += "\n";
  return ir;
}

export function getGlobalVariables(): string {
  let ir = "";
  ir += "@__argc = global i32 0\n";
  ir += "@__argv = global i8** null\n";
  ir += "\n";
  ir += "@__chadscript = global double 1.0\n";
  ir += "\n";
  ir += "@__test_total = global i32 0\n";
  ir += "@__test_passed = global i32 0\n";
  ir += "@__test_failed = global i32 0\n";
  ir += "@__test_current_failed = global i1 0\n";
  ir += "@__describe_depth = global i32 0\n";
  ir += "@__exception_stack = global i8* null\n";
  ir += "@__exception_message = global i8* null\n";
  ir += "\n";
  return ir;
}

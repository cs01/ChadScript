export function getLLVMDeclarations(): string {
  let ir = '';

  ir += '%Array = type { double*, i32, i32 }\n';
  ir += '%ObjectArray = type { i8*, i32, i32 }\n';
  ir += '%StringArray = type { i8**, i32, i32 }\n';
  ir += '%Map = type { double*, double*, i32, i32 }\n';
  ir += '%StringMap = type { i8**, i8**, i32, i32 }\n';
  ir += '%Set = type { double*, i32, i32 }\n';
  ir += '%StringSet = type { i8**, i32, i32 }\n\n';

  ir += 'declare i8* @malloc(i64)\n';
  ir += 'declare i8* @calloc(i64, i64)\n';
  ir += 'declare void @free(i8*)\n';

  ir += '; Boehm GC - automatic garbage collection\n';
  ir += 'declare void @GC_init()\n';
  ir += 'declare i8* @GC_malloc(i64)\n';
  ir += 'declare i8* @GC_malloc_atomic(i64)\n';
  ir += 'declare i8* @GC_malloc_uncollectable(i64)\n';
  ir += 'declare i8* @GC_realloc(i8*, i64)\n';
  ir += 'declare i8* @strcpy(i8*, i8*)\n';
  ir += 'declare i8* @strncpy(i8*, i8*, i64)\n';
  ir += 'declare i8* @strcat(i8*, i8*)\n';
  ir += 'declare i8* @strdup(i8*)\n';
  ir += 'declare i64 @strlen(i8*)\n';
  ir += 'declare i32 @strcmp(i8*, i8*)\n';
  ir += 'declare i32 @strncmp(i8*, i8*, i64)\n';
  ir += 'declare i32 @snprintf(i8*, i64, i8*, ...)\n';
  ir += 'declare i64 @strtol(i8*, i8**, i32)\n';
  ir += 'declare double @strtod(i8*, i8**)\n';
  ir += 'declare i8* @strstr(i8*, i8*)\n';
  ir += 'declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n';
  ir += '\n';

  ir += 'declare double @llvm.sqrt.f64(double)\n';
  ir += 'declare double @llvm.pow.f64(double, double)\n';
  ir += 'declare double @llvm.floor.f64(double)\n';
  ir += 'declare double @llvm.ceil.f64(double)\n';
  ir += 'declare double @llvm.round.f64(double)\n';
  ir += 'declare double @llvm.fabs.f64(double)\n';
  ir += '\n';

  ir += 'declare i32 @regcomp(i8*, i8*, i32)\n';
  ir += 'declare i32 @regexec(i8*, i8*, i64, i8*, i32)\n';
  ir += 'declare void @regfree(i8*)\n';
  ir += '\n';

  ir += 'declare i32 @printf(i8*, ...)\n';
  ir += 'declare i32 @fprintf(i8*, i8*, ...)\n';
  ir += '@stderr = external global i8*\n';
  ir += '\n';

  ir += 'declare void @exit(i32)\n';
  ir += 'declare i32 @fflush(i8*)\n';
  ir += '@stdout = external global i8*\n';
  ir += '\n';

  ir += '; Console format strings for inline console.log\n';
  ir += '@.str.newline = private unnamed_addr constant [2 x i8] c"\\0A\\00", align 1\n';
  ir += '@.str.strfmt = private unnamed_addr constant [4 x i8] c"%s\\0A\\00", align 1\n';
  ir += '@.str.numfmt = private unnamed_addr constant [4 x i8] c"%g\\0A\\00", align 1\n';
  ir += '@.str.hello = private unnamed_addr constant [7 x i8] c"Hello\\0A\\00", align 1\n';
  ir += '@.str.throw_fmt = private constant [11 x i8] c"Error: %s\\0A\\00"\n';
  ir += '\n';

  ir += 'declare i8* @fopen(i8*, i8*)\n';
  ir += 'declare i32 @fclose(i8*)\n';
  ir += 'declare i64 @fread(i8*, i64, i64, i8*)\n';
  ir += 'declare i64 @fwrite(i8*, i64, i64, i8*)\n';
  ir += 'declare i32 @fseek(i8*, i64, i32)\n';
  ir += 'declare i64 @ftell(i8*)\n';
  ir += 'declare i32 @unlink(i8*)\n';
  ir += '\n';

  ir += 'declare i32 @socket(i32, i32, i32)\n';
  ir += 'declare i32 @close(i32)\n';
  ir += 'declare i32 @bind(i32, i8*, i32)\n';
  ir += 'declare i32 @listen(i32, i32)\n';
  ir += 'declare i32 @accept(i32, i8*, i32*)\n';
  ir += 'declare i32 @connect(i32, i8*, i32)\n';
  ir += 'declare i64 @read(i32, i8*, i64)\n';
  ir += 'declare i64 @write(i32, i8*, i64)\n';
  ir += 'declare i16 @htons(i16)\n';
  ir += '\n';

  ir += 'declare i8* @realpath(i8*, i8*)\n';
  ir += 'declare i8* @dirname(i8*)\n';
  ir += '\n';

  ir += 'declare i32 @system(i8*)\n';
  ir += '\n';

  ir += 'declare i32 @sprintf(i8*, i8*, ...)\n';
  ir += '\n';

  ir += '; libcurl functions\n';
  ir += 'declare i8* @curl_easy_init()\n';
  ir += 'declare i32 @curl_easy_setopt(i8*, i32, ...)\n';
  ir += 'declare i32 @curl_easy_perform(i8*)\n';
  ir += 'declare void @curl_easy_cleanup(i8*)\n';
  ir += 'declare i8* @curl_easy_strerror(i32)\n';
  ir += '\n';

  ir += '@CURLOPT_URL = constant i32 10002\n';
  ir += '@CURLOPT_WRITEFUNCTION = constant i32 20011\n';
  ir += '@CURLOPT_WRITEDATA = constant i32 10001\n';
  ir += '@CURLOPT_FOLLOWLOCATION = constant i32 52\n';
  ir += '@CURLOPT_USERAGENT = constant i32 10018\n';
  ir += '\n';

  return ir;
}

export function getSafeStringHelper(): string {
  let ir = '';
  ir += '; Return empty string if pointer is NULL, otherwise return the pointer\n';
  ir += 'define i8* @__safe_string(i8* %str) {\n';
  ir += 'entry:\n';
  ir += '  %is_null = icmp eq i8* %str, null\n';
  ir += '  br i1 %is_null, label %return_empty, label %return_str\n';
  ir += '\n';
  ir += 'return_empty:\n';
  ir += '  ret i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0)\n';
  ir += '\n';
  ir += 'return_str:\n';
  ir += '  ret i8* %str\n';
  ir += '}\n';
  ir += '\n';
  ir += '@.empty_str = private unnamed_addr constant [1 x i8] c"\\00", align 1\n';
  ir += '\n';
  return ir;
}

export function getDoubleToStringHelper(): string {
  let ir = '';
  ir += '; Convert a double to its string representation\n';
  ir += '@.double_fmt = private unnamed_addr constant [3 x i8] c"%g\\00", align 1\n';
  ir += '\n';
  ir += 'define i8* @__double_to_string(double %val) {\n';
  ir += 'entry:\n';
  ir += '  %buffer = call i8* @GC_malloc_atomic(i64 32)\n';
  ir += '  %fmt = getelementptr inbounds [3 x i8], [3 x i8]* @.double_fmt, i64 0, i64 0\n';
  ir += '  call i32 (i8*, i64, i8*, ...) @snprintf(i8* %buffer, i64 32, i8* %fmt, double %val)\n';
  ir += '  ret i8* %buffer\n';
  ir += '}\n';
  ir += '\n';
  return ir;
}

export function getGlobalVariables(): string {
  let ir = '';
  ir += '@__argc = global i32 0\n';
  ir += '@__argv = global i8** null\n';
  ir += '\n';
  ir += '@__chadscript = global double 1.0\n';
  ir += '\n';
  return ir;
}

/**
 * Runtime Generator
 *
 * Generates LLVM IR runtime code for built-in features that require
 * external library support or complex implementations.
 *
 * These generators produce complete LLVM IR function definitions, type declarations,
 * and external function declarations that are included at the module level.
 *
 * Supported runtimes:
 * - Fetch API (using libcurl)
 * - JSON parsing (using cJSON library)
 * - HTTP server (using POSIX sockets)
 */
export class RuntimeGenerator {
  /**
   * Generate fetch() API implementation using libcurl
   *
   * Creates:
   * - %FetchBuffer struct type for response buffering
   * - @fetch_write_callback function for libcurl callback
   * - @fetch function that performs HTTP requests
   * - String constants for error messages and user agent
   * - External declaration for realloc()
   *
   * @returns Complete LLVM IR code for fetch() runtime
   */
  generateFetchRuntime(): string {
    let ir = "; fetch() API implementation using libcurl\n";

    ir += "%FetchBuffer = type { i8*, i64, i64 }\n";
    ir += "%__FetchResponse = type { i8*, i32, i8*, i8*, i8*, i32 }\n\n";

    ir += "define i64 @fetch_write_callback(i8* %data, i64 %size, i64 %nmemb, i8* %userdata) {\n";
    ir += "entry:\n";
    ir += "  %total_size = mul i64 %size, %nmemb\n";
    ir += "  %buffer = bitcast i8* %userdata to %FetchBuffer*\n";
    ir += "  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n";
    ir += "  %current_size = load i64, i64* %size_ptr\n";
    ir += "  %new_size = add i64 %current_size, %total_size\n";
    ir += "  %data_ptr_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n";
    ir += "  %old_data = load i8*, i8** %data_ptr_ptr\n";
    ir += "  %alloc_size = add i64 %new_size, 1\n";
    ir += "  %new_data = call i8* @realloc(i8* %old_data, i64 %alloc_size)\n";
    ir += "  store i8* %new_data, i8** %data_ptr_ptr\n";
    ir += "  %dest = getelementptr i8, i8* %new_data, i64 %current_size\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dest, i8* %data, i64 %total_size, i1 false)\n";
    ir += "  store i64 %new_size, i64* %size_ptr\n";
    ir += "  %null_pos = getelementptr i8, i8* %new_data, i64 %new_size\n";
    ir += "  store i8 0, i8* %null_pos\n";
    ir += "  ret i64 %total_size\n";
    ir += "}\n\n";

    ir += "define i64 @fetch_header_callback(i8* %data, i64 %size, i64 %nmemb, i8* %userdata) {\n";
    ir += "entry:\n";
    ir += "  %total_size = mul i64 %size, %nmemb\n";
    ir += "  %buffer = bitcast i8* %userdata to %FetchBuffer*\n";
    ir += "  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n";
    ir += "  %current_size = load i64, i64* %size_ptr\n";
    ir += "  %new_size = add i64 %current_size, %total_size\n";
    ir += "  %data_ptr_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n";
    ir += "  %old_data = load i8*, i8** %data_ptr_ptr\n";
    ir += "  %alloc_size = add i64 %new_size, 1\n";
    ir += "  %new_data = call i8* @realloc(i8* %old_data, i64 %alloc_size)\n";
    ir += "  store i8* %new_data, i8** %data_ptr_ptr\n";
    ir += "  %dest = getelementptr i8, i8* %new_data, i64 %current_size\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dest, i8* %data, i64 %total_size, i1 false)\n";
    ir += "  store i64 %new_size, i64* %size_ptr\n";
    ir += "  %null_pos = getelementptr i8, i8* %new_data, i64 %new_size\n";
    ir += "  store i8 0, i8* %null_pos\n";
    ir += "  ret i64 %total_size\n";
    ir += "}\n\n";

    ir += "define %__FetchResponse* @fetch(i8* %url) {\n";
    ir += "entry:\n";
    ir += "  %curl = call i8* @curl_easy_init()\n";
    ir += "  %curl_null = icmp eq i8* %curl, null\n";
    ir += "  br i1 %curl_null, label %error, label %curl_ok\n\n";

    ir += "curl_ok:\n";
    ir += "  %buffer = alloca %FetchBuffer\n";
    ir += "  %data_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n";
    ir += "  store i8* null, i8** %data_ptr\n";
    ir += "  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n";
    ir += "  store i64 0, i64* %size_ptr\n";
    ir += "  %cap_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 2\n";
    ir += "  store i64 0, i64* %cap_ptr\n";
    ir += "  %hdr_buffer = alloca %FetchBuffer\n";
    ir += "  %hdr_data_ptr = getelementptr %FetchBuffer, %FetchBuffer* %hdr_buffer, i32 0, i32 0\n";
    ir += "  store i8* null, i8** %hdr_data_ptr\n";
    ir += "  %hdr_size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %hdr_buffer, i32 0, i32 1\n";
    ir += "  store i64 0, i64* %hdr_size_ptr\n";
    ir += "  %hdr_cap_ptr = getelementptr %FetchBuffer, %FetchBuffer* %hdr_buffer, i32 0, i32 2\n";
    ir += "  store i64 0, i64* %hdr_cap_ptr\n";
    ir += "  %url_opt = load i32, i32* @CURLOPT_URL\n";
    ir +=
      "  %url_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %url_opt, i8* %url)\n";
    ir += "  %user_agent = getelementptr [17 x i8], [17 x i8]* @.str.user_agent, i32 0, i32 0\n";
    ir += "  %ua_opt = load i32, i32* @CURLOPT_USERAGENT\n";
    ir +=
      "  %ua_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %ua_opt, i8* %user_agent)\n";
    ir += "  %write_fn_opt = load i32, i32* @CURLOPT_WRITEFUNCTION\n";
    ir += "  %write_fn = bitcast i64 (i8*, i64, i64, i8*)* @fetch_write_callback to i8*\n";
    ir +=
      "  %write_fn_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_fn_opt, i8* %write_fn)\n";
    ir += "  %write_data_opt = load i32, i32* @CURLOPT_WRITEDATA\n";
    ir += "  %buffer_ptr = bitcast %FetchBuffer* %buffer to i8*\n";
    ir +=
      "  %write_data_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_data_opt, i8* %buffer_ptr)\n";
    ir += "  %hdr_fn_opt = load i32, i32* @CURLOPT_HEADERFUNCTION\n";
    ir += "  %hdr_fn = bitcast i64 (i8*, i64, i64, i8*)* @fetch_header_callback to i8*\n";
    ir +=
      "  %hdr_fn_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %hdr_fn_opt, i8* %hdr_fn)\n";
    ir += "  %hdr_data_opt = load i32, i32* @CURLOPT_HEADERDATA\n";
    ir += "  %hdr_buffer_ptr = bitcast %FetchBuffer* %hdr_buffer to i8*\n";
    ir +=
      "  %hdr_data_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %hdr_data_opt, i8* %hdr_buffer_ptr)\n";
    ir += "  %follow_opt = load i32, i32* @CURLOPT_FOLLOWLOCATION\n";
    ir +=
      "  %follow_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %follow_opt, i64 1)\n";
    ir += "  %perform_result = call i32 @curl_easy_perform(i8* %curl)\n";
    ir += "  %perform_ok = icmp eq i32 %perform_result, 0\n";
    ir += "  br i1 %perform_ok, label %get_status, label %fetch_error\n\n";

    ir += "get_status:\n";
    ir += "  %status_storage = alloca i64\n";
    ir += "  store i64 0, i64* %status_storage\n";
    ir += "  %info_opt = load i32, i32* @CURLINFO_RESPONSE_CODE\n";
    ir +=
      "  %info_result = call i32 (i8*, i32, ...) @curl_easy_getinfo(i8* %curl, i32 %info_opt, i64* %status_storage)\n";
    ir += "  %status_i64 = load i64, i64* %status_storage\n";
    ir += "  %status_code = trunc i64 %status_i64 to i32\n";
    ir += "  %url_storage = alloca i8*\n";
    ir += "  store i8* null, i8** %url_storage\n";
    ir += "  %url_info_opt = load i32, i32* @CURLINFO_EFFECTIVE_URL\n";
    ir +=
      "  %url_info_result = call i32 (i8*, i32, ...) @curl_easy_getinfo(i8* %curl, i32 %url_info_opt, i8** %url_storage)\n";
    ir += "  %effective_url_raw = load i8*, i8** %url_storage\n";
    ir += "  %effective_url = call i8* @strdup(i8* %effective_url_raw)\n";
    ir += "  %redir_storage = alloca i64\n";
    ir += "  store i64 0, i64* %redir_storage\n";
    ir += "  %redir_info_opt = load i32, i32* @CURLINFO_REDIRECT_COUNT\n";
    ir +=
      "  %redir_info_result = call i32 (i8*, i32, ...) @curl_easy_getinfo(i8* %curl, i32 %redir_info_opt, i64* %redir_storage)\n";
    ir += "  %redir_i64 = load i64, i64* %redir_storage\n";
    ir += "  %redir_i32 = trunc i64 %redir_i64 to i32\n";
    ir += "  %redir_gt0 = icmp sgt i32 %redir_i32, 0\n";
    ir += "  %redirected = zext i1 %redir_gt0 to i32\n";
    ir += "  %header_data = load i8*, i8** %hdr_data_ptr\n";
    ir += "  %has_headers = icmp ne i8* %header_data, null\n";
    ir += "  %empty_hdr = getelementptr [1 x i8], [1 x i8]* @.str.empty, i32 0, i32 0\n";
    ir += "  %headers_str = select i1 %has_headers, i8* %header_data, i8* %empty_hdr\n";
    ir += "  call void @curl_easy_cleanup(i8* %curl)\n";
    ir += "  %response_data = load i8*, i8** %data_ptr\n";
    ir += "  %has_data = icmp ne i8* %response_data, null\n";
    ir += "  br i1 %has_data, label %create_response, label %error\n\n";

    ir += "create_response:\n";
    ir += "  %resp_mem = call i8* @GC_malloc(i64 48)\n";
    ir += "  %resp = bitcast i8* %resp_mem to %__FetchResponse*\n";
    ir += "  %raw_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 0\n";
    ir += "  store i8* %response_data, i8** %raw_field\n";
    ir +=
      "  %status_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 1\n";
    ir += "  store i32 %status_code, i32* %status_field\n";
    ir += "  %body_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 2\n";
    ir += "  store i8* %response_data, i8** %body_field\n";
    ir += "  %url_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 3\n";
    ir += "  store i8* %effective_url, i8** %url_field\n";
    ir +=
      "  %headers_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 4\n";
    ir += "  store i8* %headers_str, i8** %headers_field\n";
    ir +=
      "  %redir_field = getelementptr %__FetchResponse, %__FetchResponse* %resp, i32 0, i32 5\n";
    ir += "  store i32 %redirected, i32* %redir_field\n";
    ir += "  ret %__FetchResponse* %resp\n\n";

    ir += "fetch_error:\n";
    ir += "  %err_str = call i8* @curl_easy_strerror(i32 %perform_result)\n";
    ir += "  %err_fmt = getelementptr [17 x i8], [17 x i8]* @.str.fetch_error, i32 0, i32 0\n";
    ir += "  call i32 (i8*, ...) @printf(i8* %err_fmt, i8* %err_str)\n";
    ir += "  call void @curl_easy_cleanup(i8* %curl)\n";
    ir += "  br label %error\n\n";

    ir += "error:\n";
    ir += "  %err_resp_mem = call i8* @GC_malloc(i64 48)\n";
    ir += "  %err_resp = bitcast i8* %err_resp_mem to %__FetchResponse*\n";
    ir += "  %empty = getelementptr [1 x i8], [1 x i8]* @.str.empty, i32 0, i32 0\n";
    ir +=
      "  %err_raw_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 0\n";
    ir += "  store i8* %empty, i8** %err_raw_field\n";
    ir +=
      "  %err_status_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 1\n";
    ir += "  store i32 0, i32* %err_status_field\n";
    ir +=
      "  %err_body_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 2\n";
    ir += "  store i8* %empty, i8** %err_body_field\n";
    ir +=
      "  %err_url_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 3\n";
    ir += "  store i8* %empty, i8** %err_url_field\n";
    ir +=
      "  %err_headers_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 4\n";
    ir += "  store i8* %empty, i8** %err_headers_field\n";
    ir +=
      "  %err_redir_field = getelementptr %__FetchResponse, %__FetchResponse* %err_resp, i32 0, i32 5\n";
    ir += "  store i32 0, i32* %err_redir_field\n";
    ir += "  ret %__FetchResponse* %err_resp\n";
    ir += "}\n\n";

    ir += '@.str.fetch_error = private constant [17 x i8] c"fetch error: %s\\0A\\00"\n';
    ir += '@.str.empty = private constant [1 x i8] c"\\00"\n';
    ir += '@.str.user_agent = private constant [17 x i8] c"ChadScript/1.0.0\\00"\n';
    ir += "@CURLINFO_RESPONSE_CODE = constant i32 2097154\n\n";

    ir += "declare i32 @curl_easy_getinfo(i8*, i32, ...)\n";
    ir += "declare i8* @realloc(i8*, i64)\n";

    return ir;
  }

  generateFetchAsyncWrapper(): string {
    let ir = "; fetch_async() - Promise-returning wrapper around sync fetch\n";
    ir += "; This enables await fetch(url) syntax\n";
    ir += "define %Promise* @fetch_async(i8* %url) {\n";
    ir += "entry:\n";
    ir += "  %response = call %__FetchResponse* @fetch(i8* %url)\n";
    ir += "  %response_i8 = bitcast %__FetchResponse* %response to i8*\n";
    ir += "  %promise = call %Promise* @__Promise_resolve_static(i8* %response_i8)\n";
    ir += "  ret %Promise* %promise\n";
    ir += "}\n\n";
    return ir;
  }

  /**
   * Generate JSON parsing runtime using cJSON library
   *
   * Creates:
   * - External declarations for cJSON library functions
   * - @cJSON_GetNumberValueAsInt helper function
   *
   * @returns Complete LLVM IR code for JSON runtime
   */
  generateJSONRuntime(): string {
    let ir = "; JSON parsing using yyjson library (via bridge)\n";

    ir += "declare i8* @csyyjson_parse(i8*)\n";
    ir += "declare void @csyyjson_free(i8*)\n";
    ir += "declare i8* @csyyjson_obj_get(i8*, i8*)\n";
    ir += "declare i8* @csyyjson_get_str(i8*)\n";
    ir += "declare double @csyyjson_get_num(i8*)\n";
    ir += "declare i32 @csyyjson_is_true(i8*)\n";
    ir += "declare i32 @csyyjson_is_num(i8*)\n";
    ir += "declare i32 @csyyjson_is_obj(i8*)\n";
    ir += "declare i32 @csyyjson_arr_size(i8*)\n";
    ir += "declare i8* @csyyjson_arr_get(i8*, i32)\n";
    ir += "declare i8* @csyyjson_val_write(i8*)\n";
    ir += "declare i8* @csyyjson_create_obj()\n";
    ir += "declare i8* @csyyjson_mut_get_root(i8*)\n";
    ir += "declare void @csyyjson_obj_add_str(i8*, i8*, i8*, i8*)\n";
    ir += "declare void @csyyjson_obj_add_num(i8*, i8*, i8*, double)\n";
    ir += "declare void @csyyjson_obj_add_bool(i8*, i8*, i8*, i32)\n";
    ir += "declare i8* @csyyjson_stringify(i8*)\n";
    ir += "declare i8* @csyyjson_stringify_pretty(i8*, i32)\n";
    ir += "declare i8* @csyyjson_create_arr()\n";
    ir += "declare i8* @csyyjson_mut_arr_add_obj(i8*, i8*)\n";
    ir += "\n";

    ir += "define i32 @csyyjson_get_num_as_int(i8* %item) {\n";
    ir += "entry:\n";
    ir += "  %double_val = call double @csyyjson_get_num(i8* %item)\n";
    ir += "  %int_val = fptosi double %double_val to i32\n";
    ir += "  ret i32 %int_val\n";
    ir += "}\n\n";

    return ir;
  }

  /**
   * Generate HTTP server runtime using POSIX sockets
   *
   * Creates:
   * - %struct.sockaddr_in type for socket addresses
   * - @parse_http_method helper function
   * - @parse_http_path helper function
   * - @http_serve main server function (accepts port and handler)
   * - String constants for HTTP responses
   *
   * @returns Complete LLVM IR code for HTTP server runtime
   */
  generateHttpServerRuntime(): string {
    let ir = "; HTTP Server Runtime\n";
    ir += "; Struct for sockaddr_in (16 bytes)\n";
    ir += "%struct.sockaddr_in = type { i16, i16, i32, [8 x i8] }\n";
    ir += "\n";

    // Helper function to parse HTTP method from request
    ir += "define i8* @parse_http_method(i8* %buffer) {\n";
    ir += "entry:\n";
    ir += '  ; Extract method from "METHOD /path HTTP/1.1"\n';
    ir += "  ; For now, just return a pointer to the start\n";
    ir += "  ret i8* %buffer\n";
    ir += "}\n\n";

    // Helper function to parse HTTP path and null-terminate it
    ir += "define i8* @parse_http_path(i8* %buffer) {\n";
    ir += "entry:\n";
    ir += "  ; Find first space (after method)\n";
    ir += "  %ptr = alloca i8*\n";
    ir += "  store i8* %buffer, i8** %ptr\n";
    ir += "  br label %find_first_space\n\n";
    ir += "find_first_space:\n";
    ir += "  %curr_ptr1 = load i8*, i8** %ptr\n";
    ir += "  %char1 = load i8, i8* %curr_ptr1\n";
    ir += "  %is_space1 = icmp eq i8 %char1, 32\n";
    ir += "  br i1 %is_space1, label %found_first_space, label %next1\n\n";
    ir += "next1:\n";
    ir += "  %next_ptr1 = getelementptr i8, i8* %curr_ptr1, i32 1\n";
    ir += "  store i8* %next_ptr1, i8** %ptr\n";
    ir += "  br label %find_first_space\n\n";
    ir += "found_first_space:\n";
    ir += "  ; Move past the space to get path start\n";
    ir += "  %path_start = getelementptr i8, i8* %curr_ptr1, i32 1\n";
    ir += "  store i8* %path_start, i8** %ptr\n";
    ir += "  br label %find_second_space\n\n";
    ir += "find_second_space:\n";
    ir += "  %curr_ptr2 = load i8*, i8** %ptr\n";
    ir += "  %char2 = load i8, i8* %curr_ptr2\n";
    ir += "  %is_space2 = icmp eq i8 %char2, 32\n";
    ir += "  br i1 %is_space2, label %found_second_space, label %next2\n\n";
    ir += "next2:\n";
    ir += "  %next_ptr2 = getelementptr i8, i8* %curr_ptr2, i32 1\n";
    ir += "  store i8* %next_ptr2, i8** %ptr\n";
    ir += "  br label %find_second_space\n\n";
    ir += "found_second_space:\n";
    ir += "  ; Null-terminate the path\n";
    ir += "  store i8 0, i8* %curr_ptr2\n";
    ir += "  ret i8* %path_start\n";
    ir += "}\n\n";

    // Main HTTP server function
    ir += "; Main HTTP server function\n";
    ir += "; Takes port number and handler function pointer\n";
    ir += "; Handler signature: i8* handler(i8* method, i8* path)\n";
    ir += "define i32 @http_serve(i32 %port, i8* (i8*, i8*)* %handler) {\n";
    ir += "entry:\n";
    ir += "  ; Constants\n";
    ir += "  %AF_INET = alloca i32\n";
    ir += "  store i32 2, i32* %AF_INET\n";
    ir += "  %SOCK_STREAM = alloca i32\n";
    ir += "  store i32 1, i32* %SOCK_STREAM\n";
    ir += "  %af_inet = load i32, i32* %AF_INET\n";
    ir += "  %sock_stream = load i32, i32* %SOCK_STREAM\n";
    ir += "\n";
    ir += "  ; Create socket\n";
    ir += "  %sock = call i32 @socket(i32 %af_inet, i32 %sock_stream, i32 0)\n";
    ir += "  %sock_valid = icmp sge i32 %sock, 0\n";
    ir += "  br i1 %sock_valid, label %socket_ok, label %error\n\n";
    ir += "socket_ok:\n";
    ir += "  ; Setup sockaddr_in\n";
    ir += "  %addr = alloca %struct.sockaddr_in\n";
    ir +=
      "  %addr_family_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 0\n";
    ir += "  store i16 2, i16* %addr_family_ptr\n"; // AF_INET
    ir += "  ; Convert port to network byte order (inline htons)\n";
    ir += "  %port_i16 = trunc i32 %port to i16\n";
    ir += "  %port_hi = lshr i16 %port_i16, 8\n";
    ir += "  %port_lo = shl i16 %port_i16, 8\n";
    ir += "  %port_net = or i16 %port_hi, %port_lo\n";
    ir +=
      "  %addr_port_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 1\n";
    ir += "  store i16 %port_net, i16* %addr_port_ptr\n";
    ir += "  ; Set address to INADDR_ANY (0.0.0.0)\n";
    ir +=
      "  %addr_addr_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 2\n";
    ir += "  store i32 0, i32* %addr_addr_ptr\n";
    ir += "\n";
    ir += "  ; Bind socket\n";
    ir += "  %addr_cast = bitcast %struct.sockaddr_in* %addr to i8*\n";
    ir += "  %bind_result = call i32 @bind(i32 %sock, i8* %addr_cast, i32 16)\n";
    ir += "  %bind_ok = icmp sge i32 %bind_result, 0\n";
    ir += "  br i1 %bind_ok, label %bind_success, label %error\n\n";
    ir += "bind_success:\n";
    ir += "  ; Listen for connections\n";
    ir += "  %listen_result = call i32 @listen(i32 %sock, i32 10)\n";
    ir += "  %listen_ok = icmp sge i32 %listen_result, 0\n";
    ir += "  br i1 %listen_ok, label %listen_success, label %error\n\n";
    ir += "listen_success:\n";
    ir += "  ; Print server started message\n";
    ir += "  %fmt = getelementptr [29 x i8], [29 x i8]* @.str.http_started, i32 0, i32 0\n";
    ir += "  call i32 (i8*, ...) @printf(i8* %fmt, i32 %port)\n";
    ir += "  br label %accept_loop\n\n";
    ir += "accept_loop:\n";
    ir += "  ; Accept incoming connection\n";
    ir += "  %client_sock = call i32 @accept(i32 %sock, i8* null, i8* null)\n";
    ir += "  %client_valid = icmp sge i32 %client_sock, 0\n";
    ir += "  br i1 %client_valid, label %handle_request, label %accept_loop\n\n";
    ir += "handle_request:\n";
    ir += "  ; Read HTTP request (up to 4096 bytes)\n";
    ir += "  %buffer = alloca [4096 x i8]\n";
    ir += "  %buffer_ptr = getelementptr [4096 x i8], [4096 x i8]* %buffer, i32 0, i32 0\n";
    ir += "  %bytes_read = call i64 @read(i32 %client_sock, i8* %buffer_ptr, i64 4096)\n";
    ir += "\n";
    ir += "  ; Parse HTTP method and path\n";
    ir += "  %method = call i8* @parse_http_method(i8* %buffer_ptr)\n";
    ir += "  %path = call i8* @parse_http_path(i8* %buffer_ptr)\n";
    ir += "\n";
    ir += "  ; Call user handler\n";
    ir += "  %response_str = call i8* %handler(i8* %method, i8* %path)\n";
    ir += "\n";
    ir += "  ; Build HTTP response\n";
    ir += "  %response_buffer = alloca [8192 x i8]\n";
    ir +=
      "  %response_ptr = getelementptr [8192 x i8], [8192 x i8]* %response_buffer, i32 0, i32 0\n";
    ir += "  %http_header = getelementptr [65 x i8], [65 x i8]* @.str.http_header, i32 0, i32 0\n";
    ir += "  %header_len = call i64 @strlen(i8* %http_header)\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %response_ptr, i8* %http_header, i64 %header_len, i1 false)\n";
    ir += "  %body_start = getelementptr i8, i8* %response_ptr, i64 %header_len\n";
    ir += "  %body_len = call i64 @strlen(i8* %response_str)\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %body_start, i8* %response_str, i64 %body_len, i1 false)\n";
    ir += "  %total_len = add i64 %header_len, %body_len\n";
    ir += "\n";
    ir += "  ; Send response\n";
    ir +=
      "  %bytes_written = call i64 @write(i32 %client_sock, i8* %response_ptr, i64 %total_len)\n";
    ir += "\n";
    ir += "  ; Close client socket\n";
    ir += "  call i32 @close(i32 %client_sock)\n";
    ir += "  br label %accept_loop\n\n";
    ir += "error:\n";
    ir += "  ret i32 1\n";
    ir += "}\n\n";

    // Add required string constants
    ir +=
      '@.str.http_started = private constant [29 x i8] c"HTTP server listening on %d\\0A\\00"\n';
    ir +=
      '@.str.http_header = private constant [65 x i8] c"HTTP/1.1 200 OK\\0D\\0AContent-Type: text/plain\\0D\\0AConnection: close\\0D\\0A\\0D\\0A\\00"\n';

    return ir;
  }

  generateStringBuilderRuntime(): string {
    let ir = "; StringBuilder append helper for O(1) amortized string concatenation\n";
    ir +=
      "define void @__cs_str_builder_append(i8** %ptr, i64* %len, i64* %cap, i8* %piece, i64 %piece_len) {\n";
    ir += "entry:\n";
    ir += "  %cur_len = load i64, i64* %len\n";
    ir += "  %cur_cap = load i64, i64* %cap\n";
    ir += "  %cur_ptr = load i8*, i8** %ptr\n";
    ir += "  %needed = add i64 %cur_len, %piece_len\n";
    ir += "  %needed1 = add i64 %needed, 1\n";
    ir += "  %fits = icmp ule i64 %needed1, %cur_cap\n";
    ir += "  br i1 %fits, label %do_copy, label %grow\n";
    ir += "grow:\n";
    ir += "  %double_cap = shl i64 %cur_cap, 1\n";
    ir += "  %min_cap = icmp ugt i64 %double_cap, %needed1\n";
    ir += "  %new_cap_tmp = select i1 %min_cap, i64 %double_cap, i64 %needed1\n";
    ir += "  %at_least_256 = icmp ugt i64 %new_cap_tmp, 256\n";
    ir += "  %new_cap = select i1 %at_least_256, i64 %new_cap_tmp, i64 256\n";
    ir += "  %was_zero = icmp eq i64 %cur_cap, 0\n";
    ir += "  br i1 %was_zero, label %fresh_alloc, label %realloc\n";
    ir += "fresh_alloc:\n";
    ir += "  %fresh = call i8* @GC_malloc_atomic(i64 %new_cap)\n";
    ir += "  %has_old = icmp ne i64 %cur_len, 0\n";
    ir += "  br i1 %has_old, label %copy_old, label %store_fresh\n";
    ir += "copy_old:\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %fresh, i8* %cur_ptr, i64 %cur_len, i1 false)\n";
    ir += "  br label %store_fresh\n";
    ir += "store_fresh:\n";
    ir += "  store i8* %fresh, i8** %ptr\n";
    ir += "  store i64 %new_cap, i64* %cap\n";
    ir += "  br label %do_copy\n";
    ir += "realloc:\n";
    ir += "  %grown = call i8* @GC_realloc(i8* %cur_ptr, i64 %new_cap)\n";
    ir += "  store i8* %grown, i8** %ptr\n";
    ir += "  store i64 %new_cap, i64* %cap\n";
    ir += "  br label %do_copy\n";
    ir += "do_copy:\n";
    ir += "  %dst_ptr = load i8*, i8** %ptr\n";
    ir += "  %dest = getelementptr i8, i8* %dst_ptr, i64 %cur_len\n";
    ir +=
      "  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dest, i8* %piece, i64 %piece_len, i1 false)\n";
    ir += "  %null_pos = getelementptr i8, i8* %dst_ptr, i64 %needed\n";
    ir += "  store i8 0, i8* %null_pos\n";
    ir += "  store i64 %needed, i64* %len\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }
}

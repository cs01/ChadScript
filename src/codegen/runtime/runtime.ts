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
    let ir = '; fetch() API implementation using libcurl\n';

    // Response buffer structure: { data: i8*, size: i64, capacity: i64 }
    ir += '%FetchBuffer = type { i8*, i64, i64 }\n';

    // Response struct layout
    ir += '%Response = type { i8*, i32, i8* }\n\n';

    // HTTP Response Parser
    ir += '; Parse HTTP response and extract status code and body\n';
    ir += 'define void @parse_http_response(i8* %raw, i32* %out_status, i8** %out_body) {\n';
    ir += 'entry:\n';
    ir += '  ; Initialize defaults\n';
    ir += '  store i32 0, i32* %out_status\n';
    ir += '  store i8* %raw, i8** %out_body\n';
    ir += '  \n';
    ir += '  ; Find status code in first line: "HTTP/1.1 200 OK\\r\\n"\n';
    ir += '  ; Status code starts after first space (position ~9)\n';
    ir += '  %p0 = getelementptr i8, i8* %raw, i64 0\n';
    ir += '  %c0 = load i8, i8* %p0\n';
    ir += '  %is_null = icmp eq i8 %c0, 0\n';
    ir += '  br i1 %is_null, label %done, label %find_status\n\n';

    ir += 'find_status:\n';
    ir += '  ; Find first space in "HTTP/1.1 200 OK"\n';
    ir += '  %space1 = call i8* @strchr(i8* %raw, i32 32)\n'; // 32 = ASCII space
    ir += '  %has_space = icmp ne i8* %space1, null\n';
    ir += '  br i1 %has_space, label %find_second_space, label %done\n\n';

    ir += 'find_second_space:\n';
    ir += '  ; Skip to next char after first space\n';
    ir += '  %after_space1 = getelementptr i8, i8* %space1, i64 1\n';
    ir += '  ; Find second space (after "1.1")\n';
    ir += '  %space2 = call i8* @strchr(i8* %after_space1, i32 32)\n';
    ir += '  %has_space2 = icmp ne i8* %space2, null\n';
    ir += '  br i1 %has_space2, label %parse_status_code, label %done\n\n';

    ir += 'parse_status_code:\n';
    ir += '  ; Skip to status code (after second space)\n';
    ir += '  %status_start = getelementptr i8, i8* %space2, i64 1\n';
    ir += '  ; Use atoi to parse the number (200, 404, etc.)\n';
    ir += '  %status_code = call i32 @atoi(i8* %status_start)\n';
    ir += '  store i32 %status_code, i32* %out_status\n';
    ir += '  br label %find_body\n\n';

    ir += 'find_body:\n';
    ir += '  ; HTTP headers end with "\\r\\n\\r\\n" (CRLF CRLF)\n';
    ir += '  ; We use strstr() to find this separator\n';
    ir += '  %sep_str = getelementptr [5 x i8], [5 x i8]* @.str.crlf_crlf, i32 0, i32 0\n';
    ir += '  %sep_pos = call i8* @strstr(i8* %raw, i8* %sep_str)\n';
    ir += '  %found_sep = icmp ne i8* %sep_pos, null\n';
    ir += '  br i1 %found_sep, label %extract_body, label %done\n\n';

    ir += 'extract_body:\n';
    ir += '  ; Body starts 4 bytes after "\\r\\n\\r\\n"\n';
    ir += '  %body_start = getelementptr i8, i8* %sep_pos, i64 4\n';
    ir += '  store i8* %body_start, i8** %out_body\n';
    ir += '  br label %done\n\n';

    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    // Write callback for libcurl (collects response data)
    ir += 'define i64 @fetch_write_callback(i8* %data, i64 %size, i64 %nmemb, i8* %userdata) {\n';
    ir += 'entry:\n';
    ir += '  ; Calculate total size\n';
    ir += '  %total_size = mul i64 %size, %nmemb\n';
    ir += '  \n';
    ir += '  ; Cast userdata to buffer pointer\n';
    ir += '  %buffer = bitcast i8* %userdata to %FetchBuffer*\n';
    ir += '  \n';
    ir += '  ; Get current size\n';
    ir += '  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n';
    ir += '  %current_size = load i64, i64* %size_ptr\n';
    ir += '  \n';
    ir += '  ; Calculate new size\n';
    ir += '  %new_size = add i64 %current_size, %total_size\n';
    ir += '  \n';
    ir += '  ; Reallocate if needed (simple: just allocate enough space)\n';
    ir += '  %data_ptr_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n';
    ir += '  %old_data = load i8*, i8** %data_ptr_ptr\n';
    ir += '  %alloc_size = add i64 %new_size, 1\n'; // +1 for null terminator
    ir += '  %new_data = call i8* @realloc(i8* %old_data, i64 %alloc_size)\n';
    ir += '  store i8* %new_data, i8** %data_ptr_ptr\n';
    ir += '  \n';
    ir += '  ; Copy new data\n';
    ir += '  %dest = getelementptr i8, i8* %new_data, i64 %current_size\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %dest, i8* %data, i64 %total_size, i1 false)\n';
    ir += '  \n';
    ir += '  ; Update size\n';
    ir += '  store i64 %new_size, i64* %size_ptr\n';
    ir += '  \n';
    ir += '  ; Null terminate\n';
    ir += '  %null_pos = getelementptr i8, i8* %new_data, i64 %new_size\n';
    ir += '  store i8 0, i8* %null_pos\n';
    ir += '  \n';
    ir += '  ret i64 %total_size\n';
    ir += '}\n\n';

    // Main fetch() function
    ir += '; fetch(url: string) -> Response object\n';
    ir += 'define %Response* @fetch(i8* %url) {\n';
    ir += 'entry:\n';
    ir += '  ; Initialize curl\n';
    ir += '  %curl = call i8* @curl_easy_init()\n';
    ir += '  %curl_null = icmp eq i8* %curl, null\n';
    ir += '  br i1 %curl_null, label %error, label %curl_ok\n\n';

    ir += 'curl_ok:\n';
    ir += '  ; Create response buffer\n';
    ir += '  %buffer = alloca %FetchBuffer\n';
    ir += '  %data_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 0\n';
    ir += '  store i8* null, i8** %data_ptr\n';
    ir += '  %size_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 1\n';
    ir += '  store i64 0, i64* %size_ptr\n';
    ir += '  %cap_ptr = getelementptr %FetchBuffer, %FetchBuffer* %buffer, i32 0, i32 2\n';
    ir += '  store i64 0, i64* %cap_ptr\n';
    ir += '  \n';
    ir += '  ; Set URL\n';
    ir += '  %url_opt = load i32, i32* @CURLOPT_URL\n';
    ir += '  %url_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %url_opt, i8* %url)\n';
    ir += '  \n';
    ir += '  ; Set User-Agent header\n';
    ir += '  %user_agent = getelementptr [17 x i8], [17 x i8]* @.str.user_agent, i32 0, i32 0\n';
    ir += '  %ua_opt = load i32, i32* @CURLOPT_USERAGENT\n';
    ir += '  %ua_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %ua_opt, i8* %user_agent)\n';
    ir += '  \n';
    ir += '  ; Set write callback\n';
    ir += '  %write_fn_opt = load i32, i32* @CURLOPT_WRITEFUNCTION\n';
    ir += '  %write_fn = bitcast i64 (i8*, i64, i64, i8*)* @fetch_write_callback to i8*\n';
    ir += '  %write_fn_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_fn_opt, i8* %write_fn)\n';
    ir += '  \n';
    ir += '  ; Set write data (our buffer)\n';
    ir += '  %write_data_opt = load i32, i32* @CURLOPT_WRITEDATA\n';
    ir += '  %buffer_ptr = bitcast %FetchBuffer* %buffer to i8*\n';
    ir += '  %write_data_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %write_data_opt, i8* %buffer_ptr)\n';
    ir += '  \n';
    ir += '  ; Follow redirects\n';
    ir += '  %follow_opt = load i32, i32* @CURLOPT_FOLLOWLOCATION\n';
    ir += '  %follow_result = call i32 (i8*, i32, ...) @curl_easy_setopt(i8* %curl, i32 %follow_opt, i64 1)\n';
    ir += '  \n';
    ir += '  ; Perform request\n';
    ir += '  %perform_result = call i32 @curl_easy_perform(i8* %curl)\n';
    ir += '  %perform_ok = icmp eq i32 %perform_result, 0\n';
    ir += '  \n';
    ir += '  ; Cleanup curl\n';
    ir += '  call void @curl_easy_cleanup(i8* %curl)\n';
    ir += '  \n';
    ir += '  ; Return response or error\n';
    ir += '  br i1 %perform_ok, label %success, label %fetch_error\n\n';

    ir += 'success:\n';
    ir += '  %response_data = load i8*, i8** %data_ptr\n';
    ir += '  %has_data = icmp ne i8* %response_data, null\n';
    ir += '  br i1 %has_data, label %create_response, label %error\n\n';

    ir += 'create_response:\n';
    ir += '  ; Allocate Response struct on heap (24 bytes aligned)\n';
    ir += '  %resp_mem = call i8* @malloc(i64 24)\n';
    ir += '  %resp = bitcast i8* %resp_mem to %Response*\n';
    ir += '  \n';
    ir += '  ; Parse the HTTP response to extract status and body\n';
    ir += '  %status_storage = alloca i32\n';
    ir += '  %body_storage = alloca i8*\n';
    ir += '  call void @parse_http_response(i8* %response_data, i32* %status_storage, i8** %body_storage)\n';
    ir += '  %status_code = load i32, i32* %status_storage\n';
    ir += '  %body_ptr = load i8*, i8** %body_storage\n';
    ir += '  \n';
    ir += '  ; Fill in Response struct fields using GEP (getelementptr)\n';
    ir += '  ; Field 0: raw_response\n';
    ir += '  %raw_field = getelementptr %Response, %Response* %resp, i32 0, i32 0\n';
    ir += '  store i8* %response_data, i8** %raw_field\n';
    ir += '  ; Field 1: status_code\n';
    ir += '  %status_field = getelementptr %Response, %Response* %resp, i32 0, i32 1\n';
    ir += '  store i32 %status_code, i32* %status_field\n';
    ir += '  ; Field 2: body\n';
    ir += '  %body_field = getelementptr %Response, %Response* %resp, i32 0, i32 2\n';
    ir += '  store i8* %body_ptr, i8** %body_field\n';
    ir += '  \n';
    ir += '  ret %Response* %resp\n\n';

    ir += 'fetch_error:\n';
    ir += '  ; Print error message\n';
    ir += '  %err_str = call i8* @curl_easy_strerror(i32 %perform_result)\n';
    ir += '  %err_fmt = getelementptr [17 x i8], [17 x i8]* @.str.fetch_error, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %err_fmt, i8* %err_str)\n';
    ir += '  br label %error\n\n';

    ir += 'error:\n';
    ir += '  ; Return error Response with status 0 and empty body\n';
    ir += '  %err_resp_mem = call i8* @malloc(i64 24)\n';
    ir += '  %err_resp = bitcast i8* %err_resp_mem to %Response*\n';
    ir += '  %empty = getelementptr [1 x i8], [1 x i8]* @.str.empty, i32 0, i32 0\n';
    ir += '  %err_raw_field = getelementptr %Response, %Response* %err_resp, i32 0, i32 0\n';
    ir += '  store i8* %empty, i8** %err_raw_field\n';
    ir += '  %err_status_field = getelementptr %Response, %Response* %err_resp, i32 0, i32 1\n';
    ir += '  store i32 0, i32* %err_status_field\n';
    ir += '  %err_body_field = getelementptr %Response, %Response* %err_resp, i32 0, i32 2\n';
    ir += '  store i8* %empty, i8** %err_body_field\n';
    ir += '  ret %Response* %err_resp\n';
    ir += '}\n\n';

    // Add required string constants
    ir += '@.str.fetch_error = private constant [17 x i8] c"fetch error: %s\\0A\\00"\n';
    ir += '@.str.empty = private constant [1 x i8] c"\\00"\n';
    ir += '@.str.user_agent = private constant [17 x i8] c"ChadScript/1.0.0\\00"\n';
    ir += '@.str.crlf_crlf = private constant [5 x i8] c"\\0D\\0A\\0D\\0A\\00"\n\n';

    // Declare C library functions for string parsing
    ir += '; C standard library functions for string parsing\n';
    ir += 'declare i8* @strchr(i8*, i32)\n';
    ir += 'declare i32 @atoi(i8*)\n';

    // Declare realloc
    ir += 'declare i8* @realloc(i8*, i64)\n';

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
    let ir = '; JSON parsing using cJSON library\n';

    // cJSON library declarations
    ir += 'declare i8* @cJSON_Parse(i8*)\n';
    ir += 'declare i8* @cJSON_GetObjectItem(i8*, i8*)\n';
    ir += 'declare void @cJSON_Delete(i8*)\n';
    ir += 'declare i32 @cJSON_IsNumber(i8*)\n';
    ir += 'declare i32 @cJSON_IsString(i8*)\n';
    ir += '\n';

    // Use cJSON's official API functions (portable across all platforms)
    // cJSON_GetNumberValue returns double, cJSON_GetStringValue returns char*
    ir += 'declare double @cJSON_GetNumberValue(i8*)\n';
    ir += 'declare i8* @cJSON_GetStringValue(i8*)\n\n';

    // Helper to convert double to i32 for integer JSON values
    ir += 'define i32 @cJSON_GetNumberValueAsInt(i8* %item) {\n';
    ir += 'entry:\n';
    ir += '  %double_val = call double @cJSON_GetNumberValue(i8* %item)\n';
    ir += '  %int_val = fptosi double %double_val to i32\n';
    ir += '  ret i32 %int_val\n';
    ir += '}\n\n';

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
    let ir = '; HTTP Server Runtime\n';
    ir += '; Struct for sockaddr_in (16 bytes)\n';
    ir += '%struct.sockaddr_in = type { i16, i16, i32, [8 x i8] }\n';
    ir += '\n';

    // Helper function to parse HTTP method from request
    ir += 'define i8* @parse_http_method(i8* %buffer) {\n';
    ir += 'entry:\n';
    ir += '  ; Extract method from "METHOD /path HTTP/1.1"\n';
    ir += '  ; For now, just return a pointer to the start\n';
    ir += '  ret i8* %buffer\n';
    ir += '}\n\n';

    // Helper function to parse HTTP path
    ir += 'define i8* @parse_http_path(i8* %buffer) {\n';
    ir += 'entry:\n';
    ir += '  ; Find first space (after method)\n';
    ir += '  %ptr = alloca i8*\n';
    ir += '  store i8* %buffer, i8** %ptr\n';
    ir += '  br label %loop\n\n';
    ir += 'loop:\n';
    ir += '  %curr_ptr = load i8*, i8** %ptr\n';
    ir += '  %char = load i8, i8* %curr_ptr\n';
    ir += '  %is_space = icmp eq i8 %char, 32\n'; // ASCII space
    ir += '  br i1 %is_space, label %found_space, label %continue\n\n';
    ir += 'continue:\n';
    ir += '  %next_ptr = getelementptr i8, i8* %curr_ptr, i32 1\n';
    ir += '  store i8* %next_ptr, i8** %ptr\n';
    ir += '  br label %loop\n\n';
    ir += 'found_space:\n';
    ir += '  ; Move past the space to get path start\n';
    ir += '  %path_start = getelementptr i8, i8* %curr_ptr, i32 1\n';
    ir += '  ret i8* %path_start\n';
    ir += '}\n\n';

    // Main HTTP server function
    ir += '; Main HTTP server function\n';
    ir += '; Takes port number and handler function pointer\n';
    ir += '; Handler signature: i32 handler(i8* method, i8* path)\n';
    ir += 'define i32 @http_serve(i32 %port, i32 (i8*, i8*)* %handler) {\n';
    ir += 'entry:\n';
    ir += '  ; Constants\n';
    ir += '  %AF_INET = alloca i32\n';
    ir += '  store i32 2, i32* %AF_INET\n';
    ir += '  %SOCK_STREAM = alloca i32\n';
    ir += '  store i32 1, i32* %SOCK_STREAM\n';
    ir += '  %af_inet = load i32, i32* %AF_INET\n';
    ir += '  %sock_stream = load i32, i32* %SOCK_STREAM\n';
    ir += '\n';
    ir += '  ; Create socket\n';
    ir += '  %sock = call i32 @socket(i32 %af_inet, i32 %sock_stream, i32 0)\n';
    ir += '  %sock_valid = icmp sge i32 %sock, 0\n';
    ir += '  br i1 %sock_valid, label %socket_ok, label %error\n\n';
    ir += 'socket_ok:\n';
    ir += '  ; Setup sockaddr_in\n';
    ir += '  %addr = alloca %struct.sockaddr_in\n';
    ir += '  %addr_family_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 0\n';
    ir += '  store i16 2, i16* %addr_family_ptr\n'; // AF_INET
    ir += '  ; Convert port to network byte order\n';
    ir += '  %port_i16 = trunc i32 %port to i16\n';
    ir += '  %port_net = call i16 @htons(i16 %port_i16)\n';
    ir += '  %addr_port_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 1\n';
    ir += '  store i16 %port_net, i16* %addr_port_ptr\n';
    ir += '  ; Set address to INADDR_ANY (0.0.0.0)\n';
    ir += '  %addr_addr_ptr = getelementptr %struct.sockaddr_in, %struct.sockaddr_in* %addr, i32 0, i32 2\n';
    ir += '  store i32 0, i32* %addr_addr_ptr\n';
    ir += '\n';
    ir += '  ; Bind socket\n';
    ir += '  %addr_cast = bitcast %struct.sockaddr_in* %addr to i8*\n';
    ir += '  %bind_result = call i32 @bind(i32 %sock, i8* %addr_cast, i32 16)\n';
    ir += '  %bind_ok = icmp sge i32 %bind_result, 0\n';
    ir += '  br i1 %bind_ok, label %bind_success, label %error\n\n';
    ir += 'bind_success:\n';
    ir += '  ; Listen for connections\n';
    ir += '  %listen_result = call i32 @listen(i32 %sock, i32 10)\n';
    ir += '  %listen_ok = icmp sge i32 %listen_result, 0\n';
    ir += '  br i1 %listen_ok, label %listen_success, label %error\n\n';
    ir += 'listen_success:\n';
    ir += '  ; Print server started message\n';
    ir += '  %fmt = getelementptr [29 x i8], [29 x i8]* @.str.http_started, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %fmt, i32 %port)\n';
    ir += '  br label %accept_loop\n\n';
    ir += 'accept_loop:\n';
    ir += '  ; Accept incoming connection\n';
    ir += '  %client_sock = call i32 @accept(i32 %sock, i8* null, i8* null)\n';
    ir += '  %client_valid = icmp sge i32 %client_sock, 0\n';
    ir += '  br i1 %client_valid, label %handle_request, label %accept_loop\n\n';
    ir += 'handle_request:\n';
    ir += '  ; Read HTTP request (up to 4096 bytes)\n';
    ir += '  %buffer = alloca [4096 x i8]\n';
    ir += '  %buffer_ptr = getelementptr [4096 x i8], [4096 x i8]* %buffer, i32 0, i32 0\n';
    ir += '  %bytes_read = call i64 @read(i32 %client_sock, i8* %buffer_ptr, i64 4096)\n';
    ir += '\n';
    ir += '  ; Parse HTTP method and path\n';
    ir += '  %method = call i8* @parse_http_method(i8* %buffer_ptr)\n';
    ir += '  %path = call i8* @parse_http_path(i8* %buffer_ptr)\n';
    ir += '\n';
    ir += '  ; Call user handler\n';
    ir += '  %response_str = call i8* %handler(i8* %method, i8* %path)\n';
    ir += '\n';
    ir += '  ; Build HTTP response\n';
    ir += '  %response_buffer = alloca [8192 x i8]\n';
    ir += '  %response_ptr = getelementptr [8192 x i8], [8192 x i8]* %response_buffer, i32 0, i32 0\n';
    ir += '  %http_header = getelementptr [65 x i8], [65 x i8]* @.str.http_header, i32 0, i32 0\n';
    ir += '  %header_len = call i64 @strlen(i8* %http_header)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %response_ptr, i8* %http_header, i64 %header_len, i1 false)\n';
    ir += '  %body_start = getelementptr i8, i8* %response_ptr, i64 %header_len\n';
    ir += '  %body_len = call i64 @strlen(i8* %response_str)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %body_start, i8* %response_str, i64 %body_len, i1 false)\n';
    ir += '  %total_len = add i64 %header_len, %body_len\n';
    ir += '\n';
    ir += '  ; Send response\n';
    ir += '  %bytes_written = call i64 @write(i32 %client_sock, i8* %response_ptr, i64 %total_len)\n';
    ir += '\n';
    ir += '  ; Close client socket\n';
    ir += '  call i32 @close(i32 %client_sock)\n';
    ir += '  br label %accept_loop\n\n';
    ir += 'error:\n';
    ir += '  ret i32 1\n';
    ir += '}\n\n';

    // Add required string constants
    ir += '@.str.http_started = private constant [29 x i8] c"HTTP server listening on %d\\0A\\00"\n';
    ir += '@.str.http_header = private constant [65 x i8] c"HTTP/1.1 200 OK\\0D\\0AContent-Type: text/plain\\0D\\0AConnection: close\\0D\\0A\\0D\\0A\\00"\n';

    return ir;
  }
}

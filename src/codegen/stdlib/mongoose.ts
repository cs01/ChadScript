/**
 * Mongoose HTTP Server Runtime Generator
 *
 * Generates LLVM IR declarations and runtime code for the mongoose
 * embedded HTTP server library. This replaces the hand-written POSIX
 * socket code with a battle-tested C library.
 *
 * Mongoose handles:
 * - Socket creation and management
 * - HTTP request parsing
 * - Response formatting
 * - Event-driven I/O
 * - WebSocket upgrade and messaging
 *
 * Library: mongoose (cesanta/mongoose)
 * Location: /data/users/cssmith/git/mongoose/mongoose.c
 */
export class MongooseGenerator {
  /**
   * Generate external declarations for mongoose functions and types
   */
  generateDeclarations(): string {
    let ir = '; Mongoose HTTP server library declarations\n';
    ir += '; Battle-tested embedded web server\n\n';

    ir += '; Mongoose manager structure (opaque, ~500 bytes)\n';
    ir += '%struct.mg_mgr = type { [512 x i8] }\n\n';

    ir += '; Mongoose connection structure (opaque)\n';
    ir += '%struct.mg_connection = type opaque\n\n';

    ir += '; Mongoose string (pointer + length)\n';
    ir += '%struct.mg_str = type { i8*, i64 }\n\n';

    ir += '; Mongoose HTTP header (name + value)\n';
    ir += '%struct.mg_http_header = type { %struct.mg_str, %struct.mg_str }\n\n';

    ir += '; Mongoose HTTP message structure\n';
    ir += '; Contains parsed HTTP request/response data\n';
    ir += '; Must match mongoose.h mg_http_message exactly\n';
    ir += '%struct.mg_http_message = type {\n';
    ir += '  %struct.mg_str,  ; 0: method (GET, POST, etc.)\n';
    ir += '  %struct.mg_str,  ; 1: uri\n';
    ir += '  %struct.mg_str,  ; 2: query\n';
    ir += '  %struct.mg_str,  ; 3: proto (HTTP/1.1)\n';
    ir += '  [30 x %struct.mg_http_header], ; 4: headers (MG_MAX_HTTP_HEADERS = 30)\n';
    ir += '  %struct.mg_str,  ; 5: body\n';
    ir += '  %struct.mg_str,  ; 6: head (request line + headers)\n';
    ir += '  %struct.mg_str   ; 7: message (full raw message)\n';
    ir += '}\n\n';

    ir += '; Mongoose WebSocket message structure\n';
    ir += '%struct.mg_ws_message = type { %struct.mg_str, i8 }\n\n';

    ir += '; Core mongoose functions\n';
    ir += 'declare void @mg_mgr_init(%struct.mg_mgr*)\n';
    ir += 'declare void @mg_mgr_free(%struct.mg_mgr*)\n';
    ir += 'declare void @mg_mgr_poll(%struct.mg_mgr*, i32)\n';
    ir += '\n';

    ir += '; HTTP server functions\n';
    ir += 'declare %struct.mg_connection* @mg_http_listen(%struct.mg_mgr*, i8*, void (%struct.mg_connection*, i32, i8*, i8*)*, i8*)\n';
    ir += 'declare void @mg_http_reply(%struct.mg_connection*, i32, i8*, i8*, ...)\n';
    ir += 'declare i32 @mg_http_match_uri(%struct.mg_http_message*, i8*)\n';
    ir += 'declare %struct.mg_str* @mg_http_get_header(%struct.mg_http_message*, i8*)\n';
    ir += '\n';

    ir += '; WebSocket functions\n';
    ir += 'declare void @mg_ws_upgrade(%struct.mg_connection*, %struct.mg_http_message*, i8*)\n';
    ir += 'declare i64 @mg_ws_send(%struct.mg_connection*, i8*, i64, i32)\n';
    ir += '\n';

    ir += '; String utility functions\n';
    ir += 'declare i32 @mg_strcmp(%struct.mg_str, %struct.mg_str)\n';
    ir += 'declare i32 @mg_vcmp(%struct.mg_str*, i8*)\n';
    ir += 'declare i8* @mg_mprintf(i8*, ...)\n';
    ir += '\n';

    ir += '; Logging control\n';
    ir += '@mg_log_level = external global i32\n';
    ir += '\n';

    ir += '; Mongoose event constants (from enum in mongoose.h)\n';
    ir += '@MG_EV_HTTP_MSG = private constant i32 11\n';
    ir += '\n';

    ir += '; zlib compression functions\n';
    ir += 'declare i32 @compress(i8*, i64*, i8*, i64)\n';
    ir += 'declare i64 @compressBound(i64)\n';
    ir += '\n';

    ir += '; zstd compression functions\n';
    ir += 'declare i64 @ZSTD_compress(i8*, i64, i8*, i64, i32)\n';
    ir += 'declare i64 @ZSTD_compressBound(i64)\n';
    ir += 'declare i32 @ZSTD_isError(i64)\n';
    ir += '\n';

    return ir;
  }

  /**
   * Generate the HTTP/WebSocket server event handler wrapper
   * This bridges mongoose's C callback to ChadScript's handler functions
   *
   * HTTP handler receives a Request object: { method: string, path: string, body: string, contentType: string }
   * HTTP handler returns a Response object: { status: number, body: string }
   *
   * WS handler receives a WsEvent object: { data: string, event: string }
   * WS handler returns a string (sent back to sender; empty = no response)
   */
  generateEventHandler(httpHandlerName: string, wsHandlerName?: string): string {
    let ir = '; HTTP/WebSocket event handler wrapper for mongoose\n';
    ir += `define void @__mg_http_handler(%struct.mg_connection* %conn, i32 %ev, i8* %ev_data, i8* %fn_data) {` + '\n';
    ir += 'entry:\n';

    if (wsHandlerName) {
      ir += '  switch i32 %ev, label %done [\n';
      ir += '    i32 11, label %handle_http\n';
      ir += '    i32 12, label %handle_ws_open\n';
      ir += '    i32 13, label %handle_ws_msg\n';
      ir += '    i32 9, label %handle_close\n';
      ir += '  ]\n\n';
    } else {
      ir += '  ; Check if this is an HTTP message event (MG_EV_HTTP_MSG = 11)\n';
      ir += '  %ev_http = load i32, i32* @MG_EV_HTTP_MSG\n';
      ir += '  %is_http = icmp eq i32 %ev, %ev_http\n';
      ir += '  br i1 %is_http, label %handle_http, label %done\n\n';
    }

    ir += 'handle_http:\n';

    if (wsHandlerName) {
      ir += '  ; Check for Upgrade: websocket header\n';
      ir += '  %hm_upgrade_check = bitcast i8* %ev_data to %struct.mg_http_message*\n';
      ir += '  %upgrade_hdr_name = getelementptr [8 x i8], [8 x i8]* @.str.upgrade_header, i32 0, i32 0\n';
      ir += '  %upgrade_ptr = call %struct.mg_str* @mg_http_get_header(%struct.mg_http_message* %hm_upgrade_check, i8* %upgrade_hdr_name)\n';
      ir += '  %has_upgrade = icmp ne %struct.mg_str* %upgrade_ptr, null\n';
      ir += '  br i1 %has_upgrade, label %do_ws_upgrade, label %handle_http_normal\n\n';

      ir += 'do_ws_upgrade:\n';
      ir += '  %null_fmt = getelementptr [1 x i8], [1 x i8]* @.str.mongoose_empty, i32 0, i32 0\n';
      ir += '  call void @mg_ws_upgrade(%struct.mg_connection* %conn, %struct.mg_http_message* %hm_upgrade_check, i8* %null_fmt)\n';
      ir += '  br label %done\n\n';

      ir += 'handle_http_normal:\n';
    }

    ir += '  ; Cast ev_data to mg_http_message*\n';
    ir += '  %hm = bitcast i8* %ev_data to %struct.mg_http_message*\n';
    ir += '\n';

    ir += '  ; Get method mg_str (first field: offset 0)\n';
    ir += '  %method_buf_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 0, i32 0\n';
    ir += '  %method_buf = load i8*, i8** %method_buf_ptr\n';
    ir += '  %method_len_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 0, i32 1\n';
    ir += '  %method_len = load i64, i64* %method_len_ptr\n';
    ir += '\n';

    ir += '  ; Get uri mg_str (second field: offset 1)\n';
    ir += '  %uri_buf_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 1, i32 0\n';
    ir += '  %uri_buf = load i8*, i8** %uri_buf_ptr\n';
    ir += '  %uri_len_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 1, i32 1\n';
    ir += '  %uri_len = load i64, i64* %uri_len_ptr\n';
    ir += '\n';

    ir += '  ; Get query mg_str (third field: offset 2)\n';
    ir += '  %query_buf_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 2, i32 0\n';
    ir += '  %query_buf = load i8*, i8** %query_buf_ptr\n';
    ir += '  %query_len_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 2, i32 1\n';
    ir += '  %query_len = load i64, i64* %query_len_ptr\n';
    ir += '\n';

    ir += '  ; Get body mg_str (field 5: after proto and headers)\n';
    ir += '  %body_buf_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 5, i32 0\n';
    ir += '  %body_buf = load i8*, i8** %body_buf_ptr\n';
    ir += '  %body_len_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 5, i32 1\n';
    ir += '  %body_len = load i64, i64* %body_len_ptr\n';
    ir += '\n';

    ir += '  ; Allocate and copy method with null terminator\n';
    ir += '  %method_alloc_size = add i64 %method_len, 1\n';
    ir += '  %method = call i8* @GC_malloc_atomic(i64 %method_alloc_size)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %method, i8* %method_buf, i64 %method_len, i1 false)\n';
    ir += '  %method_null_pos = getelementptr i8, i8* %method, i64 %method_len\n';
    ir += '  store i8 0, i8* %method_null_pos\n';
    ir += '\n';

    ir += '  ; Allocate and copy body with null terminator\n';
    ir += '  %body_alloc_size = add i64 %body_len, 1\n';
    ir += '  %body = call i8* @GC_malloc_atomic(i64 %body_alloc_size)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %body, i8* %body_buf, i64 %body_len, i1 false)\n';
    ir += '  %body_null_pos = getelementptr i8, i8* %body, i64 %body_len\n';
    ir += '  store i8 0, i8* %body_null_pos\n';
    ir += '\n';

    ir += '  ; Get Content-Type header using mg_http_get_header\n';
    ir += '  %ct_header_name = getelementptr [13 x i8], [13 x i8]* @.str.content_type_header, i32 0, i32 0\n';
    ir += '  %ct_ptr = call %struct.mg_str* @mg_http_get_header(%struct.mg_http_message* %hm, i8* %ct_header_name)\n';
    ir += '  %ct_found = icmp ne %struct.mg_str* %ct_ptr, null\n';
    ir += '  br i1 %ct_found, label %get_ct_fields, label %use_empty_ct\n\n';

    ir += 'get_ct_fields:\n';
    ir += '  %ct_buf_ptr = getelementptr %struct.mg_str, %struct.mg_str* %ct_ptr, i32 0, i32 0\n';
    ir += '  %ct_buf = load i8*, i8** %ct_buf_ptr\n';
    ir += '  %ct_len_ptr = getelementptr %struct.mg_str, %struct.mg_str* %ct_ptr, i32 0, i32 1\n';
    ir += '  %ct_len = load i64, i64* %ct_len_ptr\n';
    ir += '  %has_ct = icmp sgt i64 %ct_len, 0\n';
    ir += '  br i1 %has_ct, label %copy_content_type, label %use_empty_ct\n\n';

    ir += 'copy_content_type:\n';
    ir += '  %ct_alloc_size = add i64 %ct_len, 1\n';
    ir += '  %ct_str = call i8* @GC_malloc_atomic(i64 %ct_alloc_size)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %ct_str, i8* %ct_buf, i64 %ct_len, i1 false)\n';
    ir += '  %ct_null_pos = getelementptr i8, i8* %ct_str, i64 %ct_len\n';
    ir += '  store i8 0, i8* %ct_null_pos\n';
    ir += '  br label %build_path\n\n';

    ir += 'use_empty_ct:\n';
    ir += '  %empty_ct = getelementptr [1 x i8], [1 x i8]* @.str.mongoose_empty, i32 0, i32 0\n';
    ir += '  br label %build_path\n\n';

    ir += 'build_path:\n';
    ir += '  %content_type_val = phi i8* [ %ct_str, %copy_content_type ], [ %empty_ct, %use_empty_ct ]\n';
    ir += '\n';

    ir += '  ; Check if there is a query string\n';
    ir += '  %has_query = icmp sgt i64 %query_len, 0\n';
    ir += '  br i1 %has_query, label %build_full_path, label %use_uri_only\n\n';

    ir += 'build_full_path:\n';
    ir += '  ; Build path = uri + "?" + query\n';
    ir += '  %path_total_len = add i64 %uri_len, %query_len\n';
    ir += '  %path_total_len2 = add i64 %path_total_len, 2\n';
    ir += '  %path_full = call i8* @GC_malloc_atomic(i64 %path_total_len2)\n';
    ir += '  ; Copy uri\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %path_full, i8* %uri_buf, i64 %uri_len, i1 false)\n';
    ir += '  ; Add "?"\n';
    ir += '  %qmark_pos = getelementptr i8, i8* %path_full, i64 %uri_len\n';
    ir += '  store i8 63, i8* %qmark_pos\n';
    ir += '  ; Copy query\n';
    ir += '  %query_start = add i64 %uri_len, 1\n';
    ir += '  %query_dest = getelementptr i8, i8* %path_full, i64 %query_start\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %query_dest, i8* %query_buf, i64 %query_len, i1 false)\n';
    ir += '  ; Null terminate\n';
    ir += '  %full_path_end = add i64 %path_total_len, 1\n';
    ir += '  %path_null_pos = getelementptr i8, i8* %path_full, i64 %full_path_end\n';
    ir += '  store i8 0, i8* %path_null_pos\n';
    ir += '  br label %call_handler\n\n';

    ir += 'use_uri_only:\n';
    ir += '  ; Just copy uri without query\n';
    ir += '  %uri_alloc_size = add i64 %uri_len, 1\n';
    ir += '  %path_only = call i8* @GC_malloc_atomic(i64 %uri_alloc_size)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %path_only, i8* %uri_buf, i64 %uri_len, i1 false)\n';
    ir += '  %path_only_null = getelementptr i8, i8* %path_only, i64 %uri_len\n';
    ir += '  store i8 0, i8* %path_only_null\n';
    ir += '  br label %call_handler\n\n';

    ir += 'call_handler:\n';
    ir += '  %path = phi i8* [ %path_full, %build_full_path ], [ %path_only, %use_uri_only ]\n';
    ir += '\n';

    ir += '  ; Build Request object: { i8* method, i8* path, i8* body, i8* contentType }\n';
    ir += '  ; Allocate Request struct (4 pointers = 32 bytes)\n';
    ir += '  %req_mem = call i8* @GC_malloc(i64 32)\n';
    ir += '  %req_struct = bitcast i8* %req_mem to { i8*, i8*, i8*, i8* }*\n';
    ir += '\n';

    ir += '  ; Store method (field 0)\n';
    ir += '  %req_method_ptr = getelementptr { i8*, i8*, i8*, i8* }, { i8*, i8*, i8*, i8* }* %req_struct, i32 0, i32 0\n';
    ir += '  store i8* %method, i8** %req_method_ptr\n';
    ir += '\n';

    ir += '  ; Store path (field 1)\n';
    ir += '  %req_path_ptr = getelementptr { i8*, i8*, i8*, i8* }, { i8*, i8*, i8*, i8* }* %req_struct, i32 0, i32 1\n';
    ir += '  store i8* %path, i8** %req_path_ptr\n';
    ir += '\n';

    ir += '  ; Store body (field 2)\n';
    ir += '  %req_body_ptr = getelementptr { i8*, i8*, i8*, i8* }, { i8*, i8*, i8*, i8* }* %req_struct, i32 0, i32 2\n';
    ir += '  store i8* %body, i8** %req_body_ptr\n';
    ir += '\n';

    ir += '  ; Store contentType (field 3)\n';
    ir += '  %req_ct_ptr = getelementptr { i8*, i8*, i8*, i8* }, { i8*, i8*, i8*, i8* }* %req_struct, i32 0, i32 3\n';
    ir += '  store i8* %content_type_val, i8** %req_ct_ptr\n';
    ir += '\n';

    ir += `  ; Call user handler: ${httpHandlerName}(request) -> Response object` + '\n';
    ir += `  ; Request struct layout: { i8* method, i8* path, i8* body, i8* contentType }` + '\n';
    ir += `  ; Response struct layout: { double status, i8* body }` + '\n';
    ir += `  %response_ptr = call i8* @${httpHandlerName}(i8* %req_mem)` + '\n';
    ir += '\n';

    ir += '  ; Cast response pointer to Response struct { double, i8* }\n';
    ir += '  %response_struct = bitcast i8* %response_ptr to { double, i8* }*\n';
    ir += '\n';

    ir += '  ; Extract status code (field 0)\n';
    ir += '  %status_ptr = getelementptr { double, i8* }, { double, i8* }* %response_struct, i32 0, i32 0\n';
    ir += '  %status_dbl = load double, double* %status_ptr\n';
    ir += '  %status_code = fptosi double %status_dbl to i32\n';
    ir += '\n';

    ir += '  ; Extract body string (field 1)\n';
    ir += '  %body_ptr_loc = getelementptr { double, i8* }, { double, i8* }* %response_struct, i32 0, i32 1\n';
    ir += '  %response_body = load i8*, i8** %body_ptr_loc\n';
    ir += '\n';

    ir += '  ; Auto-detect content type from body content\n';
    ir += '  %body_first_byte = load i8, i8* %response_body\n';
    ir += '  %is_lt = icmp eq i8 %body_first_byte, 60\n';
    ir += '  br i1 %is_lt, label %ct_html, label %check_json\n\n';

    ir += 'check_json:\n';
    ir += '  %is_lbrace = icmp eq i8 %body_first_byte, 123\n';
    ir += '  %is_lbracket = icmp eq i8 %body_first_byte, 91\n';
    ir += '  %is_json = or i1 %is_lbrace, %is_lbracket\n';
    ir += '  br i1 %is_json, label %ct_json, label %ct_plain\n\n';

    ir += 'ct_html:\n';
    ir += '  %html_ct = getelementptr [26 x i8], [26 x i8]* @.str.ct_html, i32 0, i32 0\n';
    ir += '  br label %send_response\n\n';

    ir += 'ct_json:\n';
    ir += '  %json_ct = getelementptr [33 x i8], [33 x i8]* @.str.ct_json, i32 0, i32 0\n';
    ir += '  br label %send_response\n\n';

    ir += 'ct_plain:\n';
    ir += '  %plain_ct = getelementptr [27 x i8], [27 x i8]* @.str.content_type_text, i32 0, i32 0\n';
    ir += '  br label %send_response\n\n';

    ir += 'send_response:\n';
    ir += '  %final_ct = phi i8* [ %html_ct, %ct_html ], [ %json_ct, %ct_json ], [ %plain_ct, %ct_plain ]\n';
    ir += '\n';

    ir += '  ; Get body length for compression check\n';
    ir += '  %resp_body_len = call i64 @strlen(i8* %response_body)\n';
    ir += '\n';

    ir += '  ; Check for Accept-Encoding header\n';
    ir += '  %ae_header_name = getelementptr [16 x i8], [16 x i8]* @.str.accept_encoding_header, i32 0, i32 0\n';
    ir += '  %ae_ptr = call %struct.mg_str* @mg_http_get_header(%struct.mg_http_message* %hm, i8* %ae_header_name)\n';
    ir += '  %ae_found = icmp ne %struct.mg_str* %ae_ptr, null\n';
    ir += '  br i1 %ae_found, label %copy_ae, label %send_uncompressed\n\n';

    ir += 'copy_ae:\n';
    ir += '  %ae_buf_ptr = getelementptr %struct.mg_str, %struct.mg_str* %ae_ptr, i32 0, i32 0\n';
    ir += '  %ae_buf = load i8*, i8** %ae_buf_ptr\n';
    ir += '  %ae_len_ptr = getelementptr %struct.mg_str, %struct.mg_str* %ae_ptr, i32 0, i32 1\n';
    ir += '  %ae_len = load i64, i64* %ae_len_ptr\n';
    ir += '  %ae_alloc = add i64 %ae_len, 1\n';
    ir += '  %ae_str = call i8* @GC_malloc_atomic(i64 %ae_alloc)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %ae_str, i8* %ae_buf, i64 %ae_len, i1 false)\n';
    ir += '  %ae_null_pos = getelementptr i8, i8* %ae_str, i64 %ae_len\n';
    ir += '  store i8 0, i8* %ae_null_pos\n';
    ir += '  br label %check_ae_zstd\n\n';

    ir += 'check_ae_zstd:\n';
    ir += '  %zstd_needle = getelementptr [5 x i8], [5 x i8]* @.str.zstd_needle, i32 0, i32 0\n';
    ir += '  %has_zstd_ptr = call i8* @strstr(i8* %ae_str, i8* %zstd_needle)\n';
    ir += '  %has_zstd = icmp ne i8* %has_zstd_ptr, null\n';
    ir += '  br i1 %has_zstd, label %check_zstd_body_size, label %check_ae_deflate\n\n';

    ir += 'check_zstd_body_size:\n';
    ir += '  %zstd_body_big = icmp ugt i64 %resp_body_len, 256\n';
    ir += '  br i1 %zstd_body_big, label %do_zstd_compress, label %send_uncompressed\n\n';

    ir += 'do_zstd_compress:\n';
    ir += '  %zstd_max = call i64 @ZSTD_compressBound(i64 %resp_body_len)\n';
    ir += '  %zstd_buf = call i8* @GC_malloc_atomic(i64 %zstd_max)\n';
    ir += '  %zstd_result = call i64 @ZSTD_compress(i8* %zstd_buf, i64 %zstd_max, i8* %response_body, i64 %resp_body_len, i32 1)\n';
    ir += '  %zstd_err = call i32 @ZSTD_isError(i64 %zstd_result)\n';
    ir += '  %zstd_ok = icmp eq i32 %zstd_err, 0\n';
    ir += '  br i1 %zstd_ok, label %check_zstd_ratio, label %check_ae_deflate\n\n';

    ir += 'check_zstd_ratio:\n';
    ir += '  %zstd_smaller = icmp ult i64 %zstd_result, %resp_body_len\n';
    ir += '  br i1 %zstd_smaller, label %send_zstd, label %check_ae_deflate\n\n';

    ir += 'send_zstd:\n';
    ir += '  %ct_len_zstd = call i64 @strlen(i8* %final_ct)\n';
    ir += '  %ce_zstd_hdr = getelementptr [25 x i8], [25 x i8]* @.str.ce_zstd, i32 0, i32 0\n';
    ir += '  %ce_zstd_len = call i64 @strlen(i8* %ce_zstd_hdr)\n';
    ir += '  %zstd_hdr_len = add i64 %ct_len_zstd, %ce_zstd_len\n';
    ir += '  %zstd_hdr_alloc = add i64 %zstd_hdr_len, 1\n';
    ir += '  %zstd_combined_hdr = call i8* @GC_malloc_atomic(i64 %zstd_hdr_alloc)\n';
    ir += '  call i8* @strcpy(i8* %zstd_combined_hdr, i8* %final_ct)\n';
    ir += '  call i8* @strcat(i8* %zstd_combined_hdr, i8* %ce_zstd_hdr)\n';
    ir += '  %zstd_len_i32 = trunc i64 %zstd_result to i32\n';
    ir += '  %zstd_binary_fmt = getelementptr [5 x i8], [5 x i8]* @.str.body_binary_fmt, i32 0, i32 0\n';
    ir += '  call void (%struct.mg_connection*, i32, i8*, i8*, ...) @mg_http_reply(%struct.mg_connection* %conn, i32 %status_code, i8* %zstd_combined_hdr, i8* %zstd_binary_fmt, i32 %zstd_len_i32, i8* %zstd_buf)\n';
    ir += '  br label %done\n\n';

    ir += 'check_ae_deflate:\n';
    ir += '  %deflate_needle = getelementptr [8 x i8], [8 x i8]* @.str.deflate_needle, i32 0, i32 0\n';
    ir += '  %has_deflate_ptr = call i8* @strstr(i8* %ae_str, i8* %deflate_needle)\n';
    ir += '  %has_deflate = icmp ne i8* %has_deflate_ptr, null\n';
    ir += '  br i1 %has_deflate, label %check_body_size, label %send_uncompressed\n\n';

    ir += 'check_body_size:\n';
    ir += '  %body_big_enough = icmp ugt i64 %resp_body_len, 256\n';
    ir += '  br i1 %body_big_enough, label %do_compress, label %send_uncompressed\n\n';

    ir += 'do_compress:\n';
    ir += '  %max_compressed = call i64 @compressBound(i64 %resp_body_len)\n';
    ir += '  %comp_buf = call i8* @GC_malloc_atomic(i64 %max_compressed)\n';
    ir += '  %dest_len_ptr = alloca i64\n';
    ir += '  store i64 %max_compressed, i64* %dest_len_ptr\n';
    ir += '  %comp_result = call i32 @compress(i8* %comp_buf, i64* %dest_len_ptr, i8* %response_body, i64 %resp_body_len)\n';
    ir += '  %comp_ok = icmp eq i32 %comp_result, 0\n';
    ir += '  br i1 %comp_ok, label %check_ratio, label %send_uncompressed\n\n';

    ir += 'check_ratio:\n';
    ir += '  %compressed_len = load i64, i64* %dest_len_ptr\n';
    ir += '  %is_smaller = icmp ult i64 %compressed_len, %resp_body_len\n';
    ir += '  br i1 %is_smaller, label %send_compressed, label %send_uncompressed\n\n';

    ir += 'send_compressed:\n';
    ir += '  %ct_len_comp = call i64 @strlen(i8* %final_ct)\n';
    ir += '  %ce_hdr = getelementptr [28 x i8], [28 x i8]* @.str.ce_deflate, i32 0, i32 0\n';
    ir += '  %ce_len = call i64 @strlen(i8* %ce_hdr)\n';
    ir += '  %combined_hdr_len = add i64 %ct_len_comp, %ce_len\n';
    ir += '  %combined_hdr_alloc = add i64 %combined_hdr_len, 1\n';
    ir += '  %combined_hdr = call i8* @GC_malloc_atomic(i64 %combined_hdr_alloc)\n';
    ir += '  call i8* @strcpy(i8* %combined_hdr, i8* %final_ct)\n';
    ir += '  call i8* @strcat(i8* %combined_hdr, i8* %ce_hdr)\n';
    ir += '  %comp_len_i32 = trunc i64 %compressed_len to i32\n';
    ir += '  %binary_fmt = getelementptr [5 x i8], [5 x i8]* @.str.body_binary_fmt, i32 0, i32 0\n';
    ir += '  call void (%struct.mg_connection*, i32, i8*, i8*, ...) @mg_http_reply(%struct.mg_connection* %conn, i32 %status_code, i8* %combined_hdr, i8* %binary_fmt, i32 %comp_len_i32, i8* %comp_buf)\n';
    ir += '  br label %done\n\n';

    ir += 'send_uncompressed:\n';
    ir += '  %body_fmt = getelementptr [3 x i8], [3 x i8]* @.str.body_fmt, i32 0, i32 0\n';
    ir += '  call void (%struct.mg_connection*, i32, i8*, i8*, ...) @mg_http_reply(%struct.mg_connection* %conn, i32 %status_code, i8* %final_ct, i8* %body_fmt, i8* %response_body)\n';
    ir += '\n';

    ir += '  ; GC will handle cleanup of allocated strings\n';
    ir += '  br label %done\n\n';

    if (wsHandlerName) {
      ir += this.generateWsOpenHandler(wsHandlerName);
      ir += this.generateWsMsgHandler(wsHandlerName);
      ir += this.generateWsCloseHandler(wsHandlerName);
    }

    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    ir += '@.str.content_type_text = private constant [27 x i8] c"Content-Type: text/plain\\0D\\0A\\00"\n';
    ir += '@.str.ct_html = private constant [26 x i8] c"Content-Type: text/html\\0D\\0A\\00"\n';
    ir += '@.str.ct_json = private constant [33 x i8] c"Content-Type: application/json\\0D\\0A\\00"\n';
    ir += '@.str.body_fmt = private constant [3 x i8] c"%s\\00"\n';
    ir += '@.str.content_type_header = private constant [13 x i8] c"Content-Type\\00"\n';
    ir += '@.str.mongoose_empty = private constant [1 x i8] c"\\00"\n';
    ir += '@.str.accept_encoding_header = private constant [16 x i8] c"Accept-Encoding\\00"\n';
    ir += '@.str.deflate_needle = private constant [8 x i8] c"deflate\\00"\n';
    ir += '@.str.ce_deflate = private constant [28 x i8] c"Content-Encoding: deflate\\0D\\0A\\00"\n';
    ir += '@.str.body_binary_fmt = private constant [5 x i8] c"%.*s\\00"\n';
    ir += '@.str.zstd_needle = private constant [5 x i8] c"zstd\\00"\n';
    ir += '@.str.ce_zstd = private constant [25 x i8] c"Content-Encoding: zstd\\0D\\0A\\00"\n';

    if (wsHandlerName) {
      ir += '@.str.upgrade_header = private constant [8 x i8] c"Upgrade\\00"\n';
      ir += '@.str.ws_event_open = private constant [5 x i8] c"open\\00"\n';
      ir += '@.str.ws_event_message = private constant [8 x i8] c"message\\00"\n';
      ir += '@.str.ws_event_close = private constant [6 x i8] c"close\\00"\n';
    }

    return ir;
  }

  private generateWsOpenHandler(wsHandlerName: string): string {
    let ir = 'handle_ws_open:\n';
    ir += '  call void @__ws_track_add(%struct.mg_connection* %conn)\n';
    ir += '  %ws_open_evt_mem = call i8* @GC_malloc(i64 16)\n';
    ir += '  %ws_open_evt = bitcast i8* %ws_open_evt_mem to { i8*, i8* }*\n';
    ir += '  %ws_open_data_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_open_evt, i32 0, i32 0\n';
    ir += '  %ws_open_empty = getelementptr [1 x i8], [1 x i8]* @.str.mongoose_empty, i32 0, i32 0\n';
    ir += '  store i8* %ws_open_empty, i8** %ws_open_data_ptr\n';
    ir += '  %ws_open_event_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_open_evt, i32 0, i32 1\n';
    ir += '  %ws_open_event_str = getelementptr [5 x i8], [5 x i8]* @.str.ws_event_open, i32 0, i32 0\n';
    ir += '  store i8* %ws_open_event_str, i8** %ws_open_event_ptr\n';
    ir += `  %ws_open_result = call i8* @${wsHandlerName}(i8* %ws_open_evt_mem)\n`;
    ir += '  %ws_open_first = load i8, i8* %ws_open_result\n';
    ir += '  %ws_open_has_reply = icmp ne i8 %ws_open_first, 0\n';
    ir += '  br i1 %ws_open_has_reply, label %ws_open_send, label %done\n\n';

    ir += 'ws_open_send:\n';
    ir += '  %ws_open_len = call i64 @strlen(i8* %ws_open_result)\n';
    ir += '  call i64 @mg_ws_send(%struct.mg_connection* %conn, i8* %ws_open_result, i64 %ws_open_len, i32 1)\n';
    ir += '  br label %done\n\n';

    return ir;
  }

  private generateWsMsgHandler(wsHandlerName: string): string {
    let ir = 'handle_ws_msg:\n';
    ir += '  %wm = bitcast i8* %ev_data to %struct.mg_ws_message*\n';
    ir += '  %ws_data_str_ptr = getelementptr %struct.mg_ws_message, %struct.mg_ws_message* %wm, i32 0, i32 0, i32 0\n';
    ir += '  %ws_data_buf = load i8*, i8** %ws_data_str_ptr\n';
    ir += '  %ws_data_len_ptr = getelementptr %struct.mg_ws_message, %struct.mg_ws_message* %wm, i32 0, i32 0, i32 1\n';
    ir += '  %ws_data_len = load i64, i64* %ws_data_len_ptr\n';
    ir += '  %ws_data_alloc = add i64 %ws_data_len, 1\n';
    ir += '  %ws_data_copy = call i8* @GC_malloc_atomic(i64 %ws_data_alloc)\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %ws_data_copy, i8* %ws_data_buf, i64 %ws_data_len, i1 false)\n';
    ir += '  %ws_data_null = getelementptr i8, i8* %ws_data_copy, i64 %ws_data_len\n';
    ir += '  store i8 0, i8* %ws_data_null\n';
    ir += '  %ws_msg_evt_mem = call i8* @GC_malloc(i64 16)\n';
    ir += '  %ws_msg_evt = bitcast i8* %ws_msg_evt_mem to { i8*, i8* }*\n';
    ir += '  %ws_msg_data_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_msg_evt, i32 0, i32 0\n';
    ir += '  store i8* %ws_data_copy, i8** %ws_msg_data_ptr\n';
    ir += '  %ws_msg_event_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_msg_evt, i32 0, i32 1\n';
    ir += '  %ws_msg_event_str = getelementptr [8 x i8], [8 x i8]* @.str.ws_event_message, i32 0, i32 0\n';
    ir += '  store i8* %ws_msg_event_str, i8** %ws_msg_event_ptr\n';
    ir += `  %ws_msg_result = call i8* @${wsHandlerName}(i8* %ws_msg_evt_mem)\n`;
    ir += '  %ws_msg_first = load i8, i8* %ws_msg_result\n';
    ir += '  %ws_msg_has_reply = icmp ne i8 %ws_msg_first, 0\n';
    ir += '  br i1 %ws_msg_has_reply, label %ws_msg_send, label %done\n\n';

    ir += 'ws_msg_send:\n';
    ir += '  %ws_msg_reply_len = call i64 @strlen(i8* %ws_msg_result)\n';
    ir += '  call i64 @mg_ws_send(%struct.mg_connection* %conn, i8* %ws_msg_result, i64 %ws_msg_reply_len, i32 1)\n';
    ir += '  br label %done\n\n';

    return ir;
  }

  private generateWsCloseHandler(wsHandlerName: string): string {
    let ir = 'handle_close:\n';
    ir += '  call void @__ws_track_remove(%struct.mg_connection* %conn)\n';
    ir += '  %ws_close_evt_mem = call i8* @GC_malloc(i64 16)\n';
    ir += '  %ws_close_evt = bitcast i8* %ws_close_evt_mem to { i8*, i8* }*\n';
    ir += '  %ws_close_data_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_close_evt, i32 0, i32 0\n';
    ir += '  %ws_close_empty = getelementptr [1 x i8], [1 x i8]* @.str.mongoose_empty, i32 0, i32 0\n';
    ir += '  store i8* %ws_close_empty, i8** %ws_close_data_ptr\n';
    ir += '  %ws_close_event_ptr = getelementptr { i8*, i8* }, { i8*, i8* }* %ws_close_evt, i32 0, i32 1\n';
    ir += '  %ws_close_event_str = getelementptr [6 x i8], [6 x i8]* @.str.ws_event_close, i32 0, i32 0\n';
    ir += '  store i8* %ws_close_event_str, i8** %ws_close_event_ptr\n';
    ir += `  call i8* @${wsHandlerName}(i8* %ws_close_evt_mem)\n`;
    ir += '  br label %done\n\n';

    return ir;
  }

  generateWsConnectionTracking(): string {
    let ir = '; WebSocket connection tracking\n';
    ir += '@__ws_conns = global %struct.mg_connection** null\n';
    ir += '@__ws_conn_count = global i32 0\n';
    ir += '@__ws_conn_capacity = global i32 0\n\n';

    ir += 'define void @__ws_track_add(%struct.mg_connection* %conn) {\n';
    ir += 'entry:\n';
    ir += '  %count = load i32, i32* @__ws_conn_count\n';
    ir += '  %cap = load i32, i32* @__ws_conn_capacity\n';
    ir += '  %need_grow = icmp sge i32 %count, %cap\n';
    ir += '  br i1 %need_grow, label %grow, label %add\n\n';

    ir += 'grow:\n';
    ir += '  %new_cap_base = icmp eq i32 %cap, 0\n';
    ir += '  br i1 %new_cap_base, label %init_cap, label %double_cap\n\n';

    ir += 'init_cap:\n';
    ir += '  br label %do_realloc\n\n';

    ir += 'double_cap:\n';
    ir += '  %doubled = mul i32 %cap, 2\n';
    ir += '  br label %do_realloc\n\n';

    ir += 'do_realloc:\n';
    ir += '  %new_cap = phi i32 [ 16, %init_cap ], [ %doubled, %double_cap ]\n';
    ir += '  %new_cap_i64 = zext i32 %new_cap to i64\n';
    ir += '  %alloc_size = mul i64 %new_cap_i64, 8\n';
    ir += '  %new_arr = call i8* @GC_malloc(i64 %alloc_size)\n';
    ir += '  %new_arr_typed = bitcast i8* %new_arr to %struct.mg_connection**\n';
    ir += '  %old_arr = load %struct.mg_connection**, %struct.mg_connection*** @__ws_conns\n';
    ir += '  %old_is_null = icmp eq %struct.mg_connection** %old_arr, null\n';
    ir += '  br i1 %old_is_null, label %store_new, label %copy_old\n\n';

    ir += 'copy_old:\n';
    ir += '  %count_i64 = zext i32 %count to i64\n';
    ir += '  %copy_size = mul i64 %count_i64, 8\n';
    ir += '  %old_i8 = bitcast %struct.mg_connection** %old_arr to i8*\n';
    ir += '  call void @llvm.memcpy.p0i8.p0i8.i64(i8* %new_arr, i8* %old_i8, i64 %copy_size, i1 false)\n';
    ir += '  br label %store_new\n\n';

    ir += 'store_new:\n';
    ir += '  store %struct.mg_connection** %new_arr_typed, %struct.mg_connection*** @__ws_conns\n';
    ir += '  store i32 %new_cap, i32* @__ws_conn_capacity\n';
    ir += '  br label %add\n\n';

    ir += 'add:\n';
    ir += '  %cur_count = load i32, i32* @__ws_conn_count\n';
    ir += '  %arr = load %struct.mg_connection**, %struct.mg_connection*** @__ws_conns\n';
    ir += '  %idx = zext i32 %cur_count to i64\n';
    ir += '  %slot = getelementptr %struct.mg_connection*, %struct.mg_connection** %arr, i64 %idx\n';
    ir += '  store %struct.mg_connection* %conn, %struct.mg_connection** %slot\n';
    ir += '  %new_count = add i32 %cur_count, 1\n';
    ir += '  store i32 %new_count, i32* @__ws_conn_count\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    ir += 'define void @__ws_track_remove(%struct.mg_connection* %conn) {\n';
    ir += 'entry:\n';
    ir += '  %count = load i32, i32* @__ws_conn_count\n';
    ir += '  %is_zero = icmp eq i32 %count, 0\n';
    ir += '  br i1 %is_zero, label %ret, label %search_start\n\n';

    ir += 'search_start:\n';
    ir += '  %arr = load %struct.mg_connection**, %struct.mg_connection*** @__ws_conns\n';
    ir += '  br label %search_loop\n\n';

    ir += 'search_loop:\n';
    ir += '  %i = phi i32 [ 0, %search_start ], [ %i_next, %search_continue ]\n';
    ir += '  %done = icmp sge i32 %i, %count\n';
    ir += '  br i1 %done, label %ret, label %search_check\n\n';

    ir += 'search_check:\n';
    ir += '  %i_i64 = zext i32 %i to i64\n';
    ir += '  %slot = getelementptr %struct.mg_connection*, %struct.mg_connection** %arr, i64 %i_i64\n';
    ir += '  %cur = load %struct.mg_connection*, %struct.mg_connection** %slot\n';
    ir += '  %match = icmp eq %struct.mg_connection* %cur, %conn\n';
    ir += '  br i1 %match, label %found, label %search_continue\n\n';

    ir += 'search_continue:\n';
    ir += '  %i_next = add i32 %i, 1\n';
    ir += '  br label %search_loop\n\n';

    ir += 'found:\n';
    ir += '  %last_idx = sub i32 %count, 1\n';
    ir += '  %last_i64 = zext i32 %last_idx to i64\n';
    ir += '  %last_slot = getelementptr %struct.mg_connection*, %struct.mg_connection** %arr, i64 %last_i64\n';
    ir += '  %last_val = load %struct.mg_connection*, %struct.mg_connection** %last_slot\n';
    ir += '  store %struct.mg_connection* %last_val, %struct.mg_connection** %slot\n';
    ir += '  store i32 %last_idx, i32* @__ws_conn_count\n';
    ir += '  br label %ret\n\n';

    ir += 'ret:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    return ir;
  }

  generateWsBroadcastFunction(): string {
    let ir = '; WebSocket broadcast to all connected clients\n';
    ir += 'define void @__ws_broadcast(i8* %msg, i64 %len) {\n';
    ir += 'entry:\n';
    ir += '  %count = load i32, i32* @__ws_conn_count\n';
    ir += '  %is_zero = icmp eq i32 %count, 0\n';
    ir += '  br i1 %is_zero, label %ret, label %loop_start\n\n';

    ir += 'loop_start:\n';
    ir += '  %arr = load %struct.mg_connection**, %struct.mg_connection*** @__ws_conns\n';
    ir += '  br label %loop\n\n';

    ir += 'loop:\n';
    ir += '  %i = phi i32 [ 0, %loop_start ], [ %i_next, %loop_body ]\n';
    ir += '  %done = icmp sge i32 %i, %count\n';
    ir += '  br i1 %done, label %ret, label %loop_body\n\n';

    ir += 'loop_body:\n';
    ir += '  %i_i64 = zext i32 %i to i64\n';
    ir += '  %slot = getelementptr %struct.mg_connection*, %struct.mg_connection** %arr, i64 %i_i64\n';
    ir += '  %conn = load %struct.mg_connection*, %struct.mg_connection** %slot\n';
    ir += '  call i64 @mg_ws_send(%struct.mg_connection* %conn, i8* %msg, i64 %len, i32 1)\n';
    ir += '  %i_next = add i32 %i, 1\n';
    ir += '  br label %loop\n\n';

    ir += 'ret:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    return ir;
  }

  /**
   * Generate the main HTTP server function using mongoose
   * This replaces the hand-written POSIX socket code
   */
  generateHttpServeFunction(): string {
    let ir = '; httpServe(port, handler) - Start HTTP server using mongoose\n';
    ir += '; Handler takes Request object (i8*) and returns Response object (i8*)\n';
    ir += 'define i32 @http_serve(i32 %port, i8* (i8*)* %handler) {\n';
    ir += 'entry:\n';
    ir += '  ; Set log level to errors only (1 = MG_LL_ERROR)\n';
    ir += '  ; 0 = none, 1 = error, 2 = info, 3 = debug\n';
    ir += '  store i32 1, i32* @mg_log_level\n';
    ir += '\n';
    ir += '  ; Allocate mongoose manager on stack\n';
    ir += '  %mgr = alloca %struct.mg_mgr\n';
    ir += '\n';

    ir += '  ; Initialize manager\n';
    ir += '  call void @mg_mgr_init(%struct.mg_mgr* %mgr)\n';
    ir += '\n';

    ir += '  ; Build listen URL: "http://0.0.0.0:PORT"\n';
    ir += '  %url_fmt = getelementptr [18 x i8], [18 x i8]* @.str.http_url_fmt, i32 0, i32 0\n';
    ir += '  %url = call i8* (i8*, ...) @mg_mprintf(i8* %url_fmt, i32 %port)\n';
    ir += '\n';

    ir += '  ; Print startup message\n';
    ir += '  %msg_fmt = getelementptr [34 x i8], [34 x i8]* @.str.http_listening, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %msg_fmt, i32 %port)\n';
    ir += '\n';

    ir += '  ; Start HTTP listener\n';
    ir += '  %handler_ptr = bitcast i8* (i8*)* %handler to i8*\n';
    ir += '  %conn = call %struct.mg_connection* @mg_http_listen(%struct.mg_mgr* %mgr, i8* %url, void (%struct.mg_connection*, i32, i8*, i8*)* @__mg_http_handler, i8* %handler_ptr)\n';
    ir += '\n';

    ir += '  ; Check if listen succeeded\n';
    ir += '  %conn_null = icmp eq %struct.mg_connection* %conn, null\n';
    ir += '  br i1 %conn_null, label %error, label %event_loop\n\n';

    ir += 'event_loop:\n';
    ir += '  ; Poll for events (1000ms timeout)\n';
    ir += '  call void @mg_mgr_poll(%struct.mg_mgr* %mgr, i32 1000)\n';
    ir += '  br label %event_loop\n\n';

    ir += 'error:\n';
    ir += '  %err_fmt = getelementptr [30 x i8], [30 x i8]* @.str.http_error, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %err_fmt, i32 %port)\n';
    ir += '  call void @mg_mgr_free(%struct.mg_mgr* %mgr)\n';
    ir += '  ret i32 1\n';
    ir += '}\n\n';

    ir += '@.str.http_url_fmt = private constant [18 x i8] c"http://0.0.0.0:%d\\00"\n';
    ir += '@.str.http_listening = private constant [34 x i8] c"HTTP server listening on port %d\\0A\\00"\n';
    ir += '@.str.http_error = private constant [30 x i8] c"Failed to start server on %d\\0A\\00"\n';

    return ir;
  }
}

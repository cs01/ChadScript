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

    ir += '; String utility functions\n';
    ir += 'declare i32 @mg_strcmp(%struct.mg_str, %struct.mg_str)\n';
    ir += 'declare i32 @mg_vcmp(%struct.mg_str*, i8*)\n';
    ir += 'declare i8* @mg_mprintf(i8*, ...)\n';
    ir += '\n';

    ir += '; Mongoose event constants (from enum in mongoose.h)\n';
    ir += '@MG_EV_HTTP_MSG = private constant i32 11\n';
    ir += '\n';

    return ir;
  }

  /**
   * Generate the HTTP server event handler wrapper
   * This bridges mongoose's C callback to ChadScript's handler function
   *
   * Handler receives a Request object: { method: string, path: string, body: string, contentType: string }
   * Handler returns a Response object: { status: number, body: string }
   */
  generateEventHandler(handlerName: string): string {
    let ir = '; HTTP event handler wrapper for mongoose\n';
    ir += `define void @__mg_http_handler(%struct.mg_connection* %conn, i32 %ev, i8* %ev_data, i8* %fn_data) {\n`;
    ir += 'entry:\n';
    ir += '  ; Check if this is an HTTP message event (MG_EV_HTTP_MSG = 11)\n';
    ir += '  %ev_http = load i32, i32* @MG_EV_HTTP_MSG\n';
    ir += '  %is_http = icmp eq i32 %ev, %ev_http\n';
    ir += '  br i1 %is_http, label %handle_http, label %done\n\n';

    ir += 'handle_http:\n';
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

    ir += `  ; Call user handler: ${handlerName}(request) -> Response object\n`;
    ir += `  ; Request struct layout: { i8* method, i8* path, i8* body, i8* contentType }\n`;
    ir += `  ; Response struct layout: { double status, i8* body }\n`;
    ir += `  %response_ptr = call i8* @${handlerName}(i8* %req_mem)\n`;
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

    ir += '  ; Send HTTP response with extracted status code\n';
    ir += '  %resp_content_type = getelementptr [27 x i8], [27 x i8]* @.str.content_type_text, i32 0, i32 0\n';
    ir += '  %body_fmt = getelementptr [3 x i8], [3 x i8]* @.str.body_fmt, i32 0, i32 0\n';
    ir += '  call void (%struct.mg_connection*, i32, i8*, i8*, ...) @mg_http_reply(%struct.mg_connection* %conn, i32 %status_code, i8* %resp_content_type, i8* %body_fmt, i8* %response_body)\n';
    ir += '\n';

    ir += '  ; GC will handle cleanup of allocated strings\n';
    ir += '  br label %done\n\n';

    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    ir += '@.str.content_type_text = private constant [27 x i8] c"Content-Type: text/plain\\0D\\0A\\00"\n';
    ir += '@.str.body_fmt = private constant [3 x i8] c"%s\\00"\n';
    ir += '@.str.content_type_header = private constant [13 x i8] c"Content-Type\\00"\n';
    ir += '@.str.mongoose_empty = private constant [1 x i8] c"\\00"\n';

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

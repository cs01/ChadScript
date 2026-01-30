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

    ir += '; Mongoose HTTP message structure\n';
    ir += '; Contains parsed HTTP request/response data\n';
    ir += '%struct.mg_http_message = type {\n';
    ir += '  %struct.mg_str,  ; method (GET, POST, etc.)\n';
    ir += '  %struct.mg_str,  ; uri\n';
    ir += '  %struct.mg_str,  ; query\n';
    ir += '  %struct.mg_str,  ; proto (HTTP/1.1)\n';
    ir += '  [40 x %struct.mg_str], ; headers (name/value pairs, 20 headers max)\n';
    ir += '  %struct.mg_str,  ; body\n';
    ir += '  %struct.mg_str   ; message (raw message)\n';
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
    ir += 'declare %struct.mg_str @mg_http_get_header(%struct.mg_http_message*, i8*)\n';
    ir += '\n';

    ir += '; String utility functions\n';
    ir += 'declare i32 @mg_strcmp(%struct.mg_str, %struct.mg_str)\n';
    ir += 'declare i32 @mg_vcmp(%struct.mg_str*, i8*)\n';
    ir += 'declare i8* @mg_mprintf(i8*, ...)\n';
    ir += '\n';

    ir += '; Mongoose event constants\n';
    ir += '@MG_EV_HTTP_MSG = private constant i32 8\n';
    ir += '\n';

    return ir;
  }

  /**
   * Generate the HTTP server event handler wrapper
   * This bridges mongoose's C callback to ChadScript's handler function
   */
  generateEventHandler(handlerName: string): string {
    let ir = '; HTTP event handler wrapper for mongoose\n';
    ir += `define void @__mg_http_handler(%struct.mg_connection* %conn, i32 %ev, i8* %ev_data, i8* %fn_data) {\n`;
    ir += 'entry:\n';
    ir += '  ; Check if this is an HTTP message event\n';
    ir += '  %ev_http = load i32, i32* @MG_EV_HTTP_MSG\n';
    ir += '  %is_http = icmp eq i32 %ev, %ev_http\n';
    ir += '  br i1 %is_http, label %handle_http, label %done\n\n';

    ir += 'handle_http:\n';
    ir += '  ; Cast ev_data to mg_http_message*\n';
    ir += '  %hm = bitcast i8* %ev_data to %struct.mg_http_message*\n';
    ir += '\n';

    ir += '  ; Get method string\n';
    ir += '  %method_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 0, i32 0\n';
    ir += '  %method = load i8*, i8** %method_ptr\n';
    ir += '\n';

    ir += '  ; Get URI string\n';
    ir += '  %uri_ptr = getelementptr %struct.mg_http_message, %struct.mg_http_message* %hm, i32 0, i32 1, i32 0\n';
    ir += '  %uri = load i8*, i8** %uri_ptr\n';
    ir += '\n';

    ir += `  ; Call user handler: ${handlerName}(method, uri) -> response string\n`;
    ir += `  %response = call i8* @${handlerName}(i8* %method, i8* %uri)\n`;
    ir += '\n';

    ir += '  ; Send HTTP response\n';
    ir += '  %content_type = getelementptr [25 x i8], [25 x i8]* @.str.content_type_text, i32 0, i32 0\n';
    ir += '  %body_fmt = getelementptr [3 x i8], [3 x i8]* @.str.body_fmt, i32 0, i32 0\n';
    ir += '  call void (%struct.mg_connection*, i32, i8*, i8*, ...) @mg_http_reply(%struct.mg_connection* %conn, i32 200, i8* %content_type, i8* %body_fmt, i8* %response)\n';
    ir += '  br label %done\n\n';

    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    ir += '@.str.content_type_text = private constant [25 x i8] c"Content-Type: text/plain\\00"\n';
    ir += '@.str.body_fmt = private constant [3 x i8] c"%s\\00"\n';

    return ir;
  }

  /**
   * Generate the main HTTP server function using mongoose
   * This replaces the hand-written POSIX socket code
   */
  generateHttpServeFunction(): string {
    let ir = '; httpServe(port, handler) - Start HTTP server using mongoose\n';
    ir += 'define i32 @http_serve(i32 %port, i8* (i8*, i8*)* %handler) {\n';
    ir += 'entry:\n';
    ir += '  ; Allocate mongoose manager on stack\n';
    ir += '  %mgr = alloca %struct.mg_mgr\n';
    ir += '\n';

    ir += '  ; Initialize manager\n';
    ir += '  call void @mg_mgr_init(%struct.mg_mgr* %mgr)\n';
    ir += '\n';

    ir += '  ; Build listen URL: "http://0.0.0.0:PORT"\n';
    ir += '  %url_fmt = getelementptr [20 x i8], [20 x i8]* @.str.http_url_fmt, i32 0, i32 0\n';
    ir += '  %url = call i8* (i8*, ...) @mg_mprintf(i8* %url_fmt, i32 %port)\n';
    ir += '\n';

    ir += '  ; Print startup message\n';
    ir += '  %msg_fmt = getelementptr [35 x i8], [35 x i8]* @.str.http_listening, i32 0, i32 0\n';
    ir += '  call i32 (i8*, ...) @printf(i8* %msg_fmt, i32 %port)\n';
    ir += '\n';

    ir += '  ; Start HTTP listener\n';
    ir += '  %handler_ptr = bitcast i8* (i8*, i8*)* %handler to i8*\n';
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

    ir += '@.str.http_url_fmt = private constant [20 x i8] c"http://0.0.0.0:%d\\00"\n';
    ir += '@.str.http_listening = private constant [35 x i8] c"HTTP server listening on port %d\\0A\\00"\n';
    ir += '@.str.http_error = private constant [30 x i8] c"Failed to start server on %d\\0A\\00"\n';

    return ir;
  }
}

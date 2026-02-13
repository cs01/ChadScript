/**
 * HTTP Server Runtime Generator (libwebsockets via C bridge)
 *
 * Generates LLVM IR declarations and runtime code for the HTTP/WebSocket
 * server. Uses a C bridge (vendor/lws-bridge.c) that wraps libwebsockets,
 * providing HTTP keep-alive, HTTP/2 (h2c), and WebSocket support.
 *
 * The C bridge exposes a simple API:
 * - lws_bridge_serve(port, http_handler, ws_handler) — start server
 * - lws_bridge_ws_broadcast(data, len) — broadcast to all WS clients
 *
 * The IR generator creates thin wrapper functions that adapt between the
 * bridge's C calling convention and ChadScript's handler signatures.
 */
export class HttpServerGenerator {
  generateDeclarations(): string {
    let ir = '; libwebsockets HTTP server declarations (via lws-bridge)\n\n';

    ir += '; lws bridge types (match lws-bridge.h structs)\n';
    ir += '%struct.lws_bridge_request = type { i8*, i8*, i8*, i8* }\n';
    ir += '%struct.lws_bridge_response = type { i32, i8*, i64 }\n\n';

    ir += '; lws bridge functions\n';
    ir += 'declare i32 @lws_bridge_serve(i32, void (%struct.lws_bridge_request*, %struct.lws_bridge_response*)*, i8* (i8*)*)\n';
    ir += 'declare void @lws_bridge_ws_send(i8*, i8*, i32)\n';
    ir += 'declare void @lws_bridge_ws_broadcast(i8*, i32)\n';
    ir += '\n';

    return ir;
  }

  /**
   * Generate the HTTP handler wrapper that adapts between the C bridge's
   * calling convention and ChadScript's handler signature.
   *
   * Bridge calls: void wrapper(lws_bridge_request*, lws_bridge_response*)
   * User handler: i8* handler(i8* req) -> returns { double status, i8* body }*
   *
   * The lws_bridge_request struct { i8*, i8*, i8*, i8* } has the same layout
   * as the ChadScript Request object, so we can cast the pointer directly.
   */
  generateEventHandler(httpHandlerName: string, _wsHandlerName?: string): string {
    let ir = '; HTTP handler wrapper for lws-bridge\n';
    ir += 'define void @__lws_http_handler(%struct.lws_bridge_request* %req, %struct.lws_bridge_response* %resp) {\n';
    ir += 'entry:\n';

    ir += '  %req_i8 = bitcast %struct.lws_bridge_request* %req to i8*\n';
    ir += `  %response_ptr = call i8* @${httpHandlerName}(i8* %req_i8)\n`;
    ir += '\n';

    ir += '  %response_struct = bitcast i8* %response_ptr to { double, i8* }*\n';
    ir += '\n';

    ir += '  %status_ptr = getelementptr { double, i8* }, { double, i8* }* %response_struct, i32 0, i32 0\n';
    ir += '  %status_dbl = load double, double* %status_ptr\n';
    ir += '  %status_code = fptosi double %status_dbl to i32\n';
    ir += '\n';

    ir += '  %body_ptr_loc = getelementptr { double, i8* }, { double, i8* }* %response_struct, i32 0, i32 1\n';
    ir += '  %response_body = load i8*, i8** %body_ptr_loc\n';
    ir += '\n';

    ir += '  %body_len = call i64 @strlen(i8* %response_body)\n';
    ir += '\n';

    ir += '  %resp_status_ptr = getelementptr %struct.lws_bridge_response, %struct.lws_bridge_response* %resp, i32 0, i32 0\n';
    ir += '  store i32 %status_code, i32* %resp_status_ptr\n';
    ir += '\n';

    ir += '  %resp_body_ptr = getelementptr %struct.lws_bridge_response, %struct.lws_bridge_response* %resp, i32 0, i32 1\n';
    ir += '  store i8* %response_body, i8** %resp_body_ptr\n';
    ir += '\n';

    ir += '  %resp_len_ptr = getelementptr %struct.lws_bridge_response, %struct.lws_bridge_response* %resp, i32 0, i32 2\n';
    ir += '  store i64 %body_len, i64* %resp_len_ptr\n';
    ir += '\n';

    ir += '  ret void\n';
    ir += '}\n\n';

    return ir;
  }

  generateWsBroadcastFunction(): string {
    let ir = '; WebSocket broadcast to all connected clients (via lws-bridge)\n';
    ir += 'define void @__ws_broadcast(i8* %msg, i64 %len) {\n';
    ir += 'entry:\n';
    ir += '  %len32 = trunc i64 %len to i32\n';
    ir += '  call void @lws_bridge_ws_broadcast(i8* %msg, i32 %len32)\n';
    ir += '  ret void\n';
    ir += '}\n\n';

    return ir;
  }

  generateHttpServeFunction(wsHandlerName?: string): string {
    let ir = '; httpServe(port, handler) - Start HTTP server using libwebsockets\n';
    ir += 'define i32 @http_serve(i32 %port, i8* (i8*)* %handler) {\n';
    ir += 'entry:\n';

    ir += '  %http_wrapper = bitcast void (%struct.lws_bridge_request*, %struct.lws_bridge_response*)* @__lws_http_handler to void (%struct.lws_bridge_request*, %struct.lws_bridge_response*)*\n';
    ir += '\n';

    if (wsHandlerName) {
      ir += `  %ws_handler = bitcast i8* (i8*)* @${wsHandlerName} to i8* (i8*)*\n`;
    } else {
      ir += '  %ws_handler = bitcast i8* null to i8* (i8*)*\n';
    }
    ir += '\n';

    ir += '  %result = call i32 @lws_bridge_serve(i32 %port, void (%struct.lws_bridge_request*, %struct.lws_bridge_response*)* %http_wrapper, i8* (i8*)* %ws_handler)\n';
    ir += '  ret i32 %result\n';
    ir += '}\n\n';

    return ir;
  }
}

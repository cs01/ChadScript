// @test-skip
// Compiles a program that calls wsBroadcast from an HTTP handler without
// registering any wsHandler. Previously this linked-errored with
// 'use of undefined value @__ws_broadcast' because the primitive was only
// emitted when a wsHandler was present. Test is @test-skip because it
// binds port 3000 — smoke-only. The regression we want is that it compiles.
import { httpServe, wsBroadcast } from "chadscript/http";

function httpHandler(req: HttpRequest): HttpResponse {
  wsBroadcast("server push");
  return { status: 200, body: "ok", contentType: "text/plain", headers: "", bodyLen: 0 };
}

httpServe(3000, httpHandler);

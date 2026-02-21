## Replace libwebsockets with libuv + picohttpparser

### Summary

Replace the libwebsockets HTTP server backend with libuv TCP + picohttpparser, improving HTTP throughput from 3,600 req/s to 15,571 req/s (4.3x).

- **Rewrite `lws-bridge.c`** to use libuv for TCP and picohttpparser for zero-copy HTTP parsing, keeping the same C API (`lws_bridge_serve`, `lws_bridge_ws_send`, `lws_bridge_ws_broadcast`) so the LLVM IR codegen needs zero changes
- **WebSocket support preserved** via embedded SHA-1 + base64 handshake and frame parser (~100 lines), removing the OpenSSL dependency for WS
- **Vendor picohttpparser** (~300 lines, MIT, from H2O project) as a build-time dependency, remove libwebsockets (~100K lines)
- **Unify event loops**: `httpServe()` now runs on `uv_default_loop()` instead of its own `lws_service()` loop, fixing the bug where `httpServe()` and `setTimeout()` couldn't coexist
- **Optimize HTTP hot path**: eliminate per-response malloc/free by embedding write buffers in the connection struct, replace `snprintf` with memcpy of static header prefixes + fast itoa, shrink `http_conn_t` from ~1MB to ~15KB by heap-allocating the request body on demand
- **Fix C benchmark** to use epoll instead of blocking single-connection I/O for an apples-to-apples comparison

### Benchmark results

| Runtime        | Before          | After            |
| -------------- | --------------- | ---------------- |
| **ChadScript** | **3,603 req/s** | **17,770 req/s** |
| Go             | 16,420          | 17,804           |
| Node.js        | 17,552          | 17,223           |
| Bun            | 16,446          | 17,421           |
| C (epoll)      | 11,052          | 15,249           |

50 concurrent connections, 10s duration, Hello World handler.

### Files changed

| File                            | Change                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `c_bridges/lws-bridge.c`        | Complete rewrite: libuv TCP + picohttpparser + embedded WS + hot path optimization                     |
| `bench/http/c-server.c`         | Rewrite C benchmark to use epoll for fair async I/O comparison                                         |
| `scripts/build-vendor.sh`       | Remove libwebsockets, add picohttpparser, fix build order                                              |
| `src/compiler.ts`               | Update linker flags (drop `-lwebsockets`, add picohttpparser.o, add `usesMongoose` to libuv condition) |
| `src/native-compiler-lib.ts`    | Same linker flag updates for the native compiler driver                                                |
| `src/codegen/llvm-generator.ts` | Add `usesMongoose` to `needsLibuv` condition                                                           |
| `.github/workflows/ci.yml`      | Replace libwebsockets.a with picohttpparser.o in vendor checks and release packaging                   |
| `docs/public/benchmarks.json`   | Updated HTTP server benchmark numbers                                                                  |

### Test plan

- [x] `npm test` — 168/168 tests pass
- [x] `node --import tsx --test tests/http-routes.test.ts` — 16/16 HTTP tests pass (routes, POST body, query params, status codes, deflate, zstd, concurrent requests, keepalive)
- [x] `npm run verify:quick` — self-hosting passes (Stage 0 + Stage 1)
- [x] `bash bench/run-http.sh` — benchmark confirms improvement

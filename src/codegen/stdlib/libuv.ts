export class LibuvGenerator {
  generateDeclarations(includePromiseTypes?: boolean): string {
    let ir = "; libuv library declarations\n";
    ir += "; Cross-platform async I/O library (event loop, timers, etc.)\n\n";

    ir += "; uv_loop_t structure (848 bytes on x86_64 Linux)\n";
    ir += "%struct.uv_loop_s = type { [848 x i8] }\n\n";

    ir += "; uv_timer_t structure (152 bytes on x86_64 Linux)\n";
    ir += "%struct.uv_timer_s = type { [152 x i8] }\n\n";

    ir += "; Timer callback type: void (*)(uv_timer_t*)\n";
    ir += "; We store user callback in timer->data field\n\n";

    ir += "; Event loop functions\n";
    ir += "declare %struct.uv_loop_s* @uv_default_loop()\n";
    ir += "declare i32 @uv_loop_init(%struct.uv_loop_s*)\n";
    ir += "declare i32 @uv_loop_close(%struct.uv_loop_s*)\n";
    ir += "declare i32 @uv_run(%struct.uv_loop_s*, i32)\n";
    ir += "declare void @uv_stop(%struct.uv_loop_s*)\n\n";

    ir += "; Timer functions\n";
    ir += "declare i32 @uv_timer_init(%struct.uv_loop_s*, %struct.uv_timer_s*)\n";
    ir +=
      "declare i32 @uv_timer_start(%struct.uv_timer_s*, void (%struct.uv_timer_s*)*, i64, i64)\n";
    ir += "declare i32 @uv_timer_stop(%struct.uv_timer_s*)\n";
    ir += "declare void @uv_timer_set_repeat(%struct.uv_timer_s*, i64)\n";
    ir += "declare i64 @uv_timer_get_repeat(%struct.uv_timer_s*)\n\n";

    ir += "; Handle functions (for data pointer storage)\n";
    ir += "declare void @uv_handle_set_data(i8*, i8*)\n";
    ir += "declare i8* @uv_handle_get_data(i8*)\n\n";

    ir += "; Close handle\n";
    ir += "declare void @uv_close(i8*, void (i8*)*)\n\n";

    ir += "; UV_RUN_DEFAULT = 0, UV_RUN_ONCE = 1, UV_RUN_NOWAIT = 2\n";
    ir += "@UV_RUN_DEFAULT = private constant i32 0\n";
    ir += "@UV_RUN_ONCE = private constant i32 1\n";
    ir += "@UV_RUN_NOWAIT = private constant i32 2\n\n";

    ir += "; uv_work_t structure (128 bytes on x86_64 Linux)\n";
    ir += "%struct.uv_work_s = type { [128 x i8] }\n\n";

    ir += "; Work queue functions (thread pool)\n";
    ir +=
      "declare i32 @uv_queue_work(%struct.uv_loop_s*, %struct.uv_work_s*, void (%struct.uv_work_s*)*, void (%struct.uv_work_s*, i32)*)\n\n";

    ir += "; Request data functions (for storing context in uv_work_t->data)\n";
    ir += "declare void @uv_req_set_data(i8*, i8*)\n";
    ir += "declare i8* @uv_req_get_data(i8*)\n\n";

    if (includePromiseTypes) {
      ir += "; FetchWorkContext: { url, method, headers, body, response, promise }\n";
      ir += "%FetchWorkContext = type { i8*, i8*, i8*, i8*, %__FetchResponse*, %Promise* }\n\n";
    }

    return ir;
  }

  // Per-timer data block stored in timer->data. Widened in PR3 to carry a
  // trampoline handle for arrow-function closures.
  //   { i8* fn_ptr, i32 tramp_handle, i32 is_interval }
  // - fn_ptr: either a bare `void()*` user fn (tramp_handle == -1) or the
  //   per-shape trampoline `void(i8*)*` (tramp_handle >= 0).
  // - tramp_handle: slot handle from cs_tramp_alloc; -1 means "no trampoline".
  // - is_interval: 1 => repeating (free slot on clearTimer); 0 => one-shot
  //   (free slot on fire).
  generateTimerCallbackWrapper(): string {
    let ir = "; Timer data block layout (PR3): { fn_ptr, tramp_handle, is_interval }\n";
    ir += "%__TimerData = type { i8*, i32, i32 }\n\n";
    ir += "; Timer callback wrapper - dispatches either a bare fn ptr or a\n";
    ir += "; per-shape trampoline (with env recovered from cs_tramp_get).\n";
    ir += "define void @__uv_timer_callback(%struct.uv_timer_s* %handle) {\n";
    ir += "entry:\n";
    ir += "  %handle_ptr = bitcast %struct.uv_timer_s* %handle to i8*\n";
    ir += "  %data_i8 = call i8* @uv_handle_get_data(i8* %handle_ptr)\n";
    ir += "  %data = bitcast i8* %data_i8 to %__TimerData*\n";
    ir +=
      "  %fn_ptr_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 0\n";
    ir += "  %fn_i8 = load i8*, i8** %fn_ptr_slot\n";
    ir += "  %h_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 1\n";
    ir += "  %h = load i32, i32* %h_slot\n";
    ir += "  %is_tramp = icmp sge i32 %h, 0\n";
    ir += "  br i1 %is_tramp, label %tramp, label %bare\n";
    ir += "\n";
    ir += "bare:\n";
    ir += "  %bare_cb = bitcast i8* %fn_i8 to void ()*\n";
    ir += "  call void %bare_cb()\n";
    ir += "  br label %after_call\n";
    ir += "\n";
    ir += "tramp:\n";
    ir += "  %env = call i8* @cs_tramp_get(i32 %h)\n";
    ir += "  %tramp_cb = bitcast i8* %fn_i8 to void (i8*)*\n";
    ir += "  call void %tramp_cb(i8* %env)\n";
    ir += "  br label %after_call\n";
    ir += "\n";
    ir += "after_call:\n";
    ir +=
      "  ; One-shot timers free their trampoline slot here (setInterval frees in clearTimer).\n";
    ir += "  %iv_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 2\n";
    ir += "  %iv = load i32, i32* %iv_slot\n";
    ir += "  %is_oneshot = icmp eq i32 %iv, 0\n";
    ir += "  %has_tramp = icmp sge i32 %h, 0\n";
    ir += "  %should_free = and i1 %is_oneshot, %has_tramp\n";
    ir += "  br i1 %should_free, label %free_slot, label %done\n";
    ir += "\n";
    ir += "free_slot:\n";
    ir += "  call void @cs_tramp_free(i32 %h)\n";
    ir += "  ; Null the handle so a late clearTimer is a no-op.\n";
    ir += "  store i32 -1, i32* %h_slot\n";
    ir += "  br label %done\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  generateSetTimeout(): string {
    let ir = "; setTimeout(fn_ptr, tramp_handle, delay_ms) -> timer_id\n";
    ir += "; fn_ptr: bare user fn (if handle == -1) or per-shape trampoline.\n";
    ir += "; tramp_handle: -1 for bare fn path, >= 0 for closure path.\n";
    ir += "define i8* @__setTimeout(i8* %fn_ptr, i32 %tramp_handle, double %delay_ms) {\n";
    ir += "entry:\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir += "\n";
    ir += "  %timer_mem = call i8* @GC_malloc(i64 152)\n";
    ir += "  %timer = bitcast i8* %timer_mem to %struct.uv_timer_s*\n";
    ir += "  call i32 @uv_timer_init(%struct.uv_loop_s* %loop, %struct.uv_timer_s* %timer)\n";
    ir += "\n";
    ir += "  ; Allocate and populate %__TimerData = { fn_ptr, tramp_handle, 0 }.\n";
    ir += "  %data_mem = call i8* @GC_malloc(i64 16)\n";
    ir += "  %data = bitcast i8* %data_mem to %__TimerData*\n";
    ir += "  %fp_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 0\n";
    ir += "  store i8* %fn_ptr, i8** %fp_slot\n";
    ir += "  %h_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 1\n";
    ir += "  store i32 %tramp_handle, i32* %h_slot\n";
    ir += "  %iv_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 2\n";
    ir += "  store i32 0, i32* %iv_slot\n";
    ir += "\n";
    ir += "  %timer_ptr = bitcast %struct.uv_timer_s* %timer to i8*\n";
    ir += "  call void @uv_handle_set_data(i8* %timer_ptr, i8* %data_mem)\n";
    ir += "\n";
    ir += "  %delay_i64 = fptosi double %delay_ms to i64\n";
    ir +=
      "  call i32 @uv_timer_start(%struct.uv_timer_s* %timer, void (%struct.uv_timer_s*)* @__uv_timer_callback, i64 %delay_i64, i64 0)\n";
    ir += "\n";
    ir += "  ret i8* %timer_mem\n";
    ir += "}\n\n";
    return ir;
  }

  generateSetInterval(): string {
    let ir = "; setInterval(fn_ptr, tramp_handle, interval_ms) -> timer_id\n";
    ir += "define i8* @__setInterval(i8* %fn_ptr, i32 %tramp_handle, double %interval_ms) {\n";
    ir += "entry:\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir += "\n";
    ir += "  %timer_mem = call i8* @GC_malloc(i64 152)\n";
    ir += "  %timer = bitcast i8* %timer_mem to %struct.uv_timer_s*\n";
    ir += "  call i32 @uv_timer_init(%struct.uv_loop_s* %loop, %struct.uv_timer_s* %timer)\n";
    ir += "\n";
    ir += "  ; Allocate and populate %__TimerData = { fn_ptr, tramp_handle, 1 }.\n";
    ir += "  %data_mem = call i8* @GC_malloc(i64 16)\n";
    ir += "  %data = bitcast i8* %data_mem to %__TimerData*\n";
    ir += "  %fp_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 0\n";
    ir += "  store i8* %fn_ptr, i8** %fp_slot\n";
    ir += "  %h_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 1\n";
    ir += "  store i32 %tramp_handle, i32* %h_slot\n";
    ir += "  %iv_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 2\n";
    ir += "  store i32 1, i32* %iv_slot\n";
    ir += "\n";
    ir += "  %timer_ptr = bitcast %struct.uv_timer_s* %timer to i8*\n";
    ir += "  call void @uv_handle_set_data(i8* %timer_ptr, i8* %data_mem)\n";
    ir += "\n";
    ir += "  %interval_i64 = fptosi double %interval_ms to i64\n";
    ir +=
      "  call i32 @uv_timer_start(%struct.uv_timer_s* %timer, void (%struct.uv_timer_s*)* @__uv_timer_callback, i64 %interval_i64, i64 %interval_i64)\n";
    ir += "\n";
    ir += "  ret i8* %timer_mem\n";
    ir += "}\n\n";
    return ir;
  }

  generateClearTimer(): string {
    let ir = "; clearTimeout/clearInterval(timer_id) - stops the timer and\n";
    ir += "; frees the trampoline slot (if any) held by its data block.\n";
    ir += "define void @__clearTimer(i8* %timer_id) {\n";
    ir += "entry:\n";
    ir += "  %is_null = icmp eq i8* %timer_id, null\n";
    ir += "  br i1 %is_null, label %done, label %stop_timer\n";
    ir += "\n";
    ir += "stop_timer:\n";
    ir += "  %timer = bitcast i8* %timer_id to %struct.uv_timer_s*\n";
    ir += "  call i32 @uv_timer_stop(%struct.uv_timer_s* %timer)\n";
    ir += "  ; Free trampoline slot if this timer carried one.\n";
    ir += "  %data_i8 = call i8* @uv_handle_get_data(i8* %timer_id)\n";
    ir += "  %data_null = icmp eq i8* %data_i8, null\n";
    ir += "  br i1 %data_null, label %done, label %maybe_free\n";
    ir += "\n";
    ir += "maybe_free:\n";
    ir += "  %data = bitcast i8* %data_i8 to %__TimerData*\n";
    ir += "  %h_slot = getelementptr inbounds %__TimerData, %__TimerData* %data, i32 0, i32 1\n";
    ir += "  %h = load i32, i32* %h_slot\n";
    ir += "  %has_tramp = icmp sge i32 %h, 0\n";
    ir += "  br i1 %has_tramp, label %free_slot, label %done\n";
    ir += "\n";
    ir += "free_slot:\n";
    ir += "  call void @cs_tramp_free(i32 %h)\n";
    ir += "  store i32 -1, i32* %h_slot\n";
    ir += "  br label %done\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  generateRunEventLoop(): string {
    let ir = "; runEventLoop() - runs the libuv event loop until all handles are closed\n";
    ir += "define void @__runEventLoop() {\n";
    ir += "entry:\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir += "  %run_mode = load i32, i32* @UV_RUN_DEFAULT\n";
    ir += "  call i32 @uv_run(%struct.uv_loop_s* %loop, i32 %run_mode)\n";
    ir += "  ret void\n";
    ir += "}\n\n";
    return ir;
  }

  generateFetchWorkCallbacks(): string {
    let ir = "";

    ir += "; __fetch_work_cb - runs on worker thread, performs sync curl fetch\n";
    ir += "define void @__fetch_work_cb(%struct.uv_work_s* %req) {\n";
    ir += "entry:\n";
    ir += "  %req_i8 = bitcast %struct.uv_work_s* %req to i8*\n";
    ir += "  %data = call i8* @uv_req_get_data(i8* %req_i8)\n";
    ir += "  %ctx = bitcast i8* %data to %FetchWorkContext*\n";
    ir +=
      "  %url_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  %url = load i8*, i8** %url_ptr\n";
    ir +=
      "  %method_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 1\n";
    ir += "  %method = load i8*, i8** %method_ptr\n";
    ir +=
      "  %headers_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  %hdrs = load i8*, i8** %headers_ptr\n";
    ir +=
      "  %body_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 3\n";
    ir += "  %body = load i8*, i8** %body_ptr\n";
    ir +=
      "  %response = call %__FetchResponse* @fetch(i8* %url, i8* %method, i8* %hdrs, i8* %body)\n";
    ir +=
      "  %resp_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 4\n";
    ir += "  store %__FetchResponse* %response, %__FetchResponse** %resp_ptr\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    ir += "; __fetch_after_work_cb - runs on main thread, resolves the promise\n";
    ir += "define void @__fetch_after_work_cb(%struct.uv_work_s* %req, i32 %status) {\n";
    ir += "entry:\n";
    ir += "  %req_i8 = bitcast %struct.uv_work_s* %req to i8*\n";
    ir += "  %data = call i8* @uv_req_get_data(i8* %req_i8)\n";
    ir += "  %ctx = bitcast i8* %data to %FetchWorkContext*\n";
    ir +=
      "  %resp_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 4\n";
    ir += "  %response = load %__FetchResponse*, %__FetchResponse** %resp_ptr\n";
    ir +=
      "  %promise_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 5\n";
    ir += "  %promise = load %Promise*, %Promise** %promise_ptr\n";
    ir += "  %response_i8 = bitcast %__FetchResponse* %response to i8*\n";
    ir += "  call void @__Promise_resolve(%Promise* %promise, i8* %response_i8)\n";
    ir += "  ret void\n";
    ir += "}\n\n";

    return ir;
  }

  generateFetchAsync(): string {
    let ir = "; fetch_async(url, method, headers, body) -> %Promise*\n";
    ir += "; Queues a fetch on the libuv thread pool, returns a pending promise\n";
    ir += "define %Promise* @fetch_async(i8* %url, i8* %method, i8* %headers, i8* %body) {\n";
    ir += "entry:\n";
    ir += "  call void @__cs_curl_init()\n";
    ir += "  %promise = call %Promise* @__Promise_new()\n";
    ir += "  %ctx_mem = call i8* @GC_malloc(i64 48)\n";
    ir += "  %ctx = bitcast i8* %ctx_mem to %FetchWorkContext*\n";
    ir +=
      "  %url_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 0\n";
    ir += "  store i8* %url, i8** %url_ptr\n";
    ir +=
      "  %method_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 1\n";
    ir += "  store i8* %method, i8** %method_ptr\n";
    ir +=
      "  %headers_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 2\n";
    ir += "  store i8* %headers, i8** %headers_ptr\n";
    ir +=
      "  %body_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 3\n";
    ir += "  store i8* %body, i8** %body_ptr\n";
    ir +=
      "  %resp_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 4\n";
    ir += "  store %__FetchResponse* null, %__FetchResponse** %resp_ptr\n";
    ir +=
      "  %promise_ptr = getelementptr inbounds %FetchWorkContext, %FetchWorkContext* %ctx, i32 0, i32 5\n";
    ir += "  store %Promise* %promise, %Promise** %promise_ptr\n";
    ir += "  %req_mem = call i8* @GC_malloc(i64 128)\n";
    ir += "  %req = bitcast i8* %req_mem to %struct.uv_work_s*\n";
    ir += "  call void @uv_req_set_data(i8* %req_mem, i8* %ctx_mem)\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir +=
      "  call i32 @uv_queue_work(%struct.uv_loop_s* %loop, %struct.uv_work_s* %req, void (%struct.uv_work_s*)* @__fetch_work_cb, void (%struct.uv_work_s*, i32)* @__fetch_after_work_cb)\n";
    ir += "  ret %Promise* %promise\n";
    ir += "}\n\n";
    return ir;
  }

  generatePromiseAwait(): string {
    let ir = "; __Promise_await(%Promise*) -> i8*\n";
    ir += "; Drives the event loop until the promise settles, then returns the value\n";
    ir += "define i8* @__Promise_await(%Promise* %promise) {\n";
    ir += "entry:\n";
    ir += "  %loop = call %struct.uv_loop_s* @uv_default_loop()\n";
    ir += "  br label %check\n";
    ir += "\n";
    ir += "check:\n";
    ir += "  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n";
    ir += "  %state = load i32, i32* %state_ptr\n";
    ir += "  %is_pending = icmp eq i32 %state, 0\n";
    ir += "  br i1 %is_pending, label %spin, label %done\n";
    ir += "\n";
    ir += "spin:\n";
    ir += "  %run_mode = load i32, i32* @UV_RUN_ONCE\n";
    ir += "  call i32 @uv_run(%struct.uv_loop_s* %loop, i32 %run_mode)\n";
    ir += "  br label %check\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n";
    ir += "  %value = load i8*, i8** %value_ptr\n";
    ir += "  ret i8* %value\n";
    ir += "}\n\n";
    return ir;
  }
}

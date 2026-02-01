export class LibuvGenerator {
  generateDeclarations(): string {
    let ir = '; libuv library declarations\n';
    ir += '; Cross-platform async I/O library (event loop, timers, etc.)\n\n';

    ir += '; uv_loop_t structure (848 bytes on x86_64 Linux)\n';
    ir += '%struct.uv_loop_s = type { [848 x i8] }\n\n';

    ir += '; uv_timer_t structure (152 bytes on x86_64 Linux)\n';
    ir += '%struct.uv_timer_s = type { [152 x i8] }\n\n';

    ir += '; Timer callback type: void (*)(uv_timer_t*)\n';
    ir += '; We store user callback in timer->data field\n\n';

    ir += '; Event loop functions\n';
    ir += 'declare %struct.uv_loop_s* @uv_default_loop()\n';
    ir += 'declare i32 @uv_loop_init(%struct.uv_loop_s*)\n';
    ir += 'declare i32 @uv_loop_close(%struct.uv_loop_s*)\n';
    ir += 'declare i32 @uv_run(%struct.uv_loop_s*, i32)\n';
    ir += 'declare void @uv_stop(%struct.uv_loop_s*)\n\n';

    ir += '; Timer functions\n';
    ir += 'declare i32 @uv_timer_init(%struct.uv_loop_s*, %struct.uv_timer_s*)\n';
    ir += 'declare i32 @uv_timer_start(%struct.uv_timer_s*, void (%struct.uv_timer_s*)*, i64, i64)\n';
    ir += 'declare i32 @uv_timer_stop(%struct.uv_timer_s*)\n';
    ir += 'declare void @uv_timer_set_repeat(%struct.uv_timer_s*, i64)\n';
    ir += 'declare i64 @uv_timer_get_repeat(%struct.uv_timer_s*)\n\n';

    ir += '; Handle functions (for data pointer storage)\n';
    ir += 'declare void @uv_handle_set_data(i8*, i8*)\n';
    ir += 'declare i8* @uv_handle_get_data(i8*)\n\n';

    ir += '; Close handle\n';
    ir += 'declare void @uv_close(i8*, void (i8*)*)\n\n';

    ir += '; UV_RUN_DEFAULT = 0, UV_RUN_ONCE = 1, UV_RUN_NOWAIT = 2\n';
    ir += '@UV_RUN_DEFAULT = private constant i32 0\n';
    ir += '@UV_RUN_ONCE = private constant i32 1\n';
    ir += '@UV_RUN_NOWAIT = private constant i32 2\n\n';

    return ir;
  }

  generateTimerCallbackWrapper(): string {
    let ir = '; Timer callback wrapper - calls user function stored in handle->data\n';
    ir += 'define void @__uv_timer_callback(%struct.uv_timer_s* %handle) {\n';
    ir += 'entry:\n';
    ir += '  ; Get handle as i8* for uv_handle_get_data\n';
    ir += '  %handle_ptr = bitcast %struct.uv_timer_s* %handle to i8*\n';
    ir += '  ; Get user callback from handle->data\n';
    ir += '  %callback_ptr = call i8* @uv_handle_get_data(i8* %handle_ptr)\n';
    ir += '  ; Cast to function pointer and call\n';
    ir += '  %callback = bitcast i8* %callback_ptr to void ()*\n';
    ir += '  call void %callback()\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generateSetTimeout(): string {
    let ir = '; setTimeout(callback, delay_ms) -> timer_id\n';
    ir += '; Creates a one-shot timer that fires after delay_ms milliseconds\n';
    ir += 'define i8* @__setTimeout(void ()* %callback, double %delay_ms) {\n';
    ir += 'entry:\n';
    ir += '  ; Get the default event loop\n';
    ir += '  %loop = call %struct.uv_loop_s* @uv_default_loop()\n';
    ir += '\n';
    ir += '  ; Allocate timer handle (152 bytes)\n';
    ir += '  %timer_mem = call i8* @GC_malloc(i64 152)\n';
    ir += '  %timer = bitcast i8* %timer_mem to %struct.uv_timer_s*\n';
    ir += '\n';
    ir += '  ; Initialize timer\n';
    ir += '  call i32 @uv_timer_init(%struct.uv_loop_s* %loop, %struct.uv_timer_s* %timer)\n';
    ir += '\n';
    ir += '  ; Store user callback in timer->data\n';
    ir += '  %timer_ptr = bitcast %struct.uv_timer_s* %timer to i8*\n';
    ir += '  %callback_ptr = bitcast void ()* %callback to i8*\n';
    ir += '  call void @uv_handle_set_data(i8* %timer_ptr, i8* %callback_ptr)\n';
    ir += '\n';
    ir += '  ; Convert delay to i64\n';
    ir += '  %delay_i64 = fptosi double %delay_ms to i64\n';
    ir += '\n';
    ir += '  ; Start timer (timeout, repeat=0 for one-shot)\n';
    ir += '  call i32 @uv_timer_start(%struct.uv_timer_s* %timer, void (%struct.uv_timer_s*)* @__uv_timer_callback, i64 %delay_i64, i64 0)\n';
    ir += '\n';
    ir += '  ; Return timer handle as timer ID\n';
    ir += '  ret i8* %timer_mem\n';
    ir += '}\n\n';
    return ir;
  }

  generateSetInterval(): string {
    let ir = '; setInterval(callback, interval_ms) -> timer_id\n';
    ir += '; Creates a repeating timer that fires every interval_ms milliseconds\n';
    ir += 'define i8* @__setInterval(void ()* %callback, double %interval_ms) {\n';
    ir += 'entry:\n';
    ir += '  ; Get the default event loop\n';
    ir += '  %loop = call %struct.uv_loop_s* @uv_default_loop()\n';
    ir += '\n';
    ir += '  ; Allocate timer handle (152 bytes)\n';
    ir += '  %timer_mem = call i8* @GC_malloc(i64 152)\n';
    ir += '  %timer = bitcast i8* %timer_mem to %struct.uv_timer_s*\n';
    ir += '\n';
    ir += '  ; Initialize timer\n';
    ir += '  call i32 @uv_timer_init(%struct.uv_loop_s* %loop, %struct.uv_timer_s* %timer)\n';
    ir += '\n';
    ir += '  ; Store user callback in timer->data\n';
    ir += '  %timer_ptr = bitcast %struct.uv_timer_s* %timer to i8*\n';
    ir += '  %callback_ptr = bitcast void ()* %callback to i8*\n';
    ir += '  call void @uv_handle_set_data(i8* %timer_ptr, i8* %callback_ptr)\n';
    ir += '\n';
    ir += '  ; Convert interval to i64\n';
    ir += '  %interval_i64 = fptosi double %interval_ms to i64\n';
    ir += '\n';
    ir += '  ; Start timer (timeout=interval, repeat=interval for repeating)\n';
    ir += '  call i32 @uv_timer_start(%struct.uv_timer_s* %timer, void (%struct.uv_timer_s*)* @__uv_timer_callback, i64 %interval_i64, i64 %interval_i64)\n';
    ir += '\n';
    ir += '  ; Return timer handle as timer ID\n';
    ir += '  ret i8* %timer_mem\n';
    ir += '}\n\n';
    return ir;
  }

  generateClearTimer(): string {
    let ir = '; clearTimeout/clearInterval(timer_id)\n';
    ir += '; Stops a timer created by setTimeout or setInterval\n';
    ir += 'define void @__clearTimer(i8* %timer_id) {\n';
    ir += 'entry:\n';
    ir += '  ; Check for null\n';
    ir += '  %is_null = icmp eq i8* %timer_id, null\n';
    ir += '  br i1 %is_null, label %done, label %stop_timer\n';
    ir += '\n';
    ir += 'stop_timer:\n';
    ir += '  %timer = bitcast i8* %timer_id to %struct.uv_timer_s*\n';
    ir += '  call i32 @uv_timer_stop(%struct.uv_timer_s* %timer)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generateRunEventLoop(): string {
    let ir = '; runEventLoop() - runs the libuv event loop until all handles are closed\n';
    ir += 'define void @__runEventLoop() {\n';
    ir += 'entry:\n';
    ir += '  %loop = call %struct.uv_loop_s* @uv_default_loop()\n';
    ir += '  %run_mode = load i32, i32* @UV_RUN_DEFAULT\n';
    ir += '  call i32 @uv_run(%struct.uv_loop_s* %loop, i32 %run_mode)\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }
}

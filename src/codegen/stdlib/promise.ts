export class PromiseGenerator {
  generateDeclarations(): string {
    let ir = '; Promise type declarations\n';
    ir += '; State machine: 0 = pending, 1 = fulfilled, 2 = rejected\n\n';

    ir += '; Callback node for .then()/.catch() chains\n';
    ir += '; { next: %PromiseCallback*, onFulfilled: void (i8*)*, onRejected: void (i8*)*, childPromise: %Promise* }\n';
    ir += '%PromiseCallback = type { %PromiseCallback*, void (i8*)*, void (i8*)*, %Promise* }\n\n';

    ir += '; Promise struct: { state: i32, value: i8*, callbacks: %PromiseCallback* }\n';
    ir += '%Promise = type { i32, i8*, %PromiseCallback* }\n\n';

    return ir;
  }

  generatePromiseNew(): string {
    let ir = '; __Promise_new() -> %Promise*\n';
    ir += '; Creates a new pending promise\n';
    ir += 'define %Promise* @__Promise_new() {\n';
    ir += 'entry:\n';
    ir += '  %mem = call i8* @GC_malloc(i64 24)\n';
    ir += '  %promise = bitcast i8* %mem to %Promise*\n';
    ir += '  ; Initialize state = 0 (pending)\n';
    ir += '  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n';
    ir += '  store i32 0, i32* %state_ptr\n';
    ir += '  ; Initialize value = null\n';
    ir += '  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n';
    ir += '  store i8* null, i8** %value_ptr\n';
    ir += '  ; Initialize callbacks = null\n';
    ir += '  %callbacks_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 2\n';
    ir += '  store %PromiseCallback* null, %PromiseCallback** %callbacks_ptr\n';
    ir += '  ret %Promise* %promise\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseResolve(): string {
    let ir = '; __Promise_resolve(%Promise* promise, i8* value)\n';
    ir += '; Resolves a promise with the given value and runs all callbacks\n';
    ir += 'define void @__Promise_resolve(%Promise* %promise, i8* %value) {\n';
    ir += 'entry:\n';
    ir += '  ; Check if already settled\n';
    ir += '  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n';
    ir += '  %state = load i32, i32* %state_ptr\n';
    ir += '  %is_pending = icmp eq i32 %state, 0\n';
    ir += '  br i1 %is_pending, label %do_resolve, label %done\n';
    ir += '\n';
    ir += 'do_resolve:\n';
    ir += '  ; Set state = 1 (fulfilled)\n';
    ir += '  store i32 1, i32* %state_ptr\n';
    ir += '  ; Set value\n';
    ir += '  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n';
    ir += '  store i8* %value, i8** %value_ptr\n';
    ir += '  ; Run callbacks\n';
    ir += '  call void @__Promise_runCallbacks(%Promise* %promise)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseReject(): string {
    let ir = '; __Promise_reject(%Promise* promise, i8* reason)\n';
    ir += '; Rejects a promise with the given reason and runs all callbacks\n';
    ir += 'define void @__Promise_reject(%Promise* %promise, i8* %reason) {\n';
    ir += 'entry:\n';
    ir += '  ; Check if already settled\n';
    ir += '  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n';
    ir += '  %state = load i32, i32* %state_ptr\n';
    ir += '  %is_pending = icmp eq i32 %state, 0\n';
    ir += '  br i1 %is_pending, label %do_reject, label %done\n';
    ir += '\n';
    ir += 'do_reject:\n';
    ir += '  ; Set state = 2 (rejected)\n';
    ir += '  store i32 2, i32* %state_ptr\n';
    ir += '  ; Set value (reason)\n';
    ir += '  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n';
    ir += '  store i8* %reason, i8** %value_ptr\n';
    ir += '  ; Run callbacks\n';
    ir += '  call void @__Promise_runCallbacks(%Promise* %promise)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseRunCallbacks(): string {
    let ir = '; __Promise_runCallbacks(%Promise* promise)\n';
    ir += '; Runs all pending callbacks (onFulfilled or onRejected based on state)\n';
    ir += 'define void @__Promise_runCallbacks(%Promise* %promise) {\n';
    ir += 'entry:\n';
    ir += '  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n';
    ir += '  %state = load i32, i32* %state_ptr\n';
    ir += '  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n';
    ir += '  %value = load i8*, i8** %value_ptr\n';
    ir += '  %callbacks_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 2\n';
    ir += '  %first_callback = load %PromiseCallback*, %PromiseCallback** %callbacks_ptr\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'loop:\n';
    ir += '  %callback = phi %PromiseCallback* [ %first_callback, %entry ], [ %next, %continue ]\n';
    ir += '  %is_null = icmp eq %PromiseCallback* %callback, null\n';
    ir += '  br i1 %is_null, label %done, label %process\n';
    ir += '\n';
    ir += 'process:\n';
    ir += '  ; Check state to determine which callback to run\n';
    ir += '  %is_fulfilled = icmp eq i32 %state, 1\n';
    ir += '  br i1 %is_fulfilled, label %run_fulfilled, label %check_rejected\n';
    ir += '\n';
    ir += 'run_fulfilled:\n';
    ir += '  %on_fulfilled_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %callback, i32 0, i32 1\n';
    ir += '  %on_fulfilled = load void (i8*)*, void (i8*)** %on_fulfilled_ptr\n';
    ir += '  %has_on_fulfilled = icmp ne void (i8*)* %on_fulfilled, null\n';
    ir += '  br i1 %has_on_fulfilled, label %call_fulfilled, label %continue\n';
    ir += '\n';
    ir += 'call_fulfilled:\n';
    ir += '  call void %on_fulfilled(i8* %value)\n';
    ir += '  br label %continue\n';
    ir += '\n';
    ir += 'check_rejected:\n';
    ir += '  %is_rejected = icmp eq i32 %state, 2\n';
    ir += '  br i1 %is_rejected, label %run_rejected, label %continue\n';
    ir += '\n';
    ir += 'run_rejected:\n';
    ir += '  %on_rejected_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %callback, i32 0, i32 2\n';
    ir += '  %on_rejected = load void (i8*)*, void (i8*)** %on_rejected_ptr\n';
    ir += '  %has_on_rejected = icmp ne void (i8*)* %on_rejected, null\n';
    ir += '  br i1 %has_on_rejected, label %call_rejected, label %continue\n';
    ir += '\n';
    ir += 'call_rejected:\n';
    ir += '  call void %on_rejected(i8* %value)\n';
    ir += '  br label %continue\n';
    ir += '\n';
    ir += 'continue:\n';
    ir += '  %next_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %callback, i32 0, i32 0\n';
    ir += '  %next = load %PromiseCallback*, %PromiseCallback** %next_ptr\n';
    ir += '  br label %loop\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ; Clear callbacks after running\n';
    ir += '  store %PromiseCallback* null, %PromiseCallback** %callbacks_ptr\n';
    ir += '  ret void\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseThen(): string {
    let ir = '; __Promise_then(%Promise* promise, void (i8*)* onFulfilled, void (i8*)* onRejected) -> %Promise*\n';
    ir += '; Adds callbacks and returns a new promise for chaining\n';
    ir += 'define %Promise* @__Promise_then(%Promise* %promise, void (i8*)* %onFulfilled, void (i8*)* %onRejected) {\n';
    ir += 'entry:\n';
    ir += '  ; Create child promise\n';
    ir += '  %child = call %Promise* @__Promise_new()\n';
    ir += '\n';
    ir += '  ; Allocate callback node\n';
    ir += '  %cb_mem = call i8* @GC_malloc(i64 32)\n';
    ir += '  %cb = bitcast i8* %cb_mem to %PromiseCallback*\n';
    ir += '\n';
    ir += '  ; Initialize callback node\n';
    ir += '  %cb_next_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %cb, i32 0, i32 0\n';
    ir += '  store %PromiseCallback* null, %PromiseCallback** %cb_next_ptr\n';
    ir += '  %cb_fulfilled_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %cb, i32 0, i32 1\n';
    ir += '  store void (i8*)* %onFulfilled, void (i8*)** %cb_fulfilled_ptr\n';
    ir += '  %cb_rejected_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %cb, i32 0, i32 2\n';
    ir += '  store void (i8*)* %onRejected, void (i8*)** %cb_rejected_ptr\n';
    ir += '  %cb_child_ptr = getelementptr inbounds %PromiseCallback, %PromiseCallback* %cb, i32 0, i32 3\n';
    ir += '  store %Promise* %child, %Promise** %cb_child_ptr\n';
    ir += '\n';
    ir += '  ; Check if promise is already settled\n';
    ir += '  %state_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 0\n';
    ir += '  %state = load i32, i32* %state_ptr\n';
    ir += '  %is_pending = icmp eq i32 %state, 0\n';
    ir += '  br i1 %is_pending, label %add_callback, label %run_immediately\n';
    ir += '\n';
    ir += 'add_callback:\n';
    ir += '  ; Promise is pending, add to callback list\n';
    ir += '  %callbacks_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 2\n';
    ir += '  %existing = load %PromiseCallback*, %PromiseCallback** %callbacks_ptr\n';
    ir += '  store %PromiseCallback* %cb_next_ptr, %PromiseCallback** %cb_next_ptr\n';
    ir += '  ; Append to end of list (simplified: prepend)\n';
    ir += '  store %PromiseCallback* %existing, %PromiseCallback** %cb_next_ptr\n';
    ir += '  store %PromiseCallback* %cb, %PromiseCallback** %callbacks_ptr\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'run_immediately:\n';
    ir += '  ; Promise already settled, run callback immediately via microtask\n';
    ir += '  %value_ptr = getelementptr inbounds %Promise, %Promise* %promise, i32 0, i32 1\n';
    ir += '  %value = load i8*, i8** %value_ptr\n';
    ir += '  %is_fulfilled = icmp eq i32 %state, 1\n';
    ir += '  br i1 %is_fulfilled, label %call_fulfilled, label %call_rejected\n';
    ir += '\n';
    ir += 'call_fulfilled:\n';
    ir += '  %has_fulfilled = icmp ne void (i8*)* %onFulfilled, null\n';
    ir += '  br i1 %has_fulfilled, label %do_call_fulfilled, label %done\n';
    ir += '\n';
    ir += 'do_call_fulfilled:\n';
    ir += '  call void %onFulfilled(i8* %value)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'call_rejected:\n';
    ir += '  %has_rejected = icmp ne void (i8*)* %onRejected, null\n';
    ir += '  br i1 %has_rejected, label %do_call_rejected, label %done\n';
    ir += '\n';
    ir += 'do_call_rejected:\n';
    ir += '  call void %onRejected(i8* %value)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ret %Promise* %child\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseResolveStatic(): string {
    let ir = '; __Promise_resolve_static(i8* value) -> %Promise*\n';
    ir += '; Creates an already-resolved promise (Promise.resolve(value))\n';
    ir += 'define %Promise* @__Promise_resolve_static(i8* %value) {\n';
    ir += 'entry:\n';
    ir += '  %promise = call %Promise* @__Promise_new()\n';
    ir += '  call void @__Promise_resolve(%Promise* %promise, i8* %value)\n';
    ir += '  ret %Promise* %promise\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseRejectStatic(): string {
    let ir = '; __Promise_reject_static(i8* reason) -> %Promise*\n';
    ir += '; Creates an already-rejected promise (Promise.reject(reason))\n';
    ir += 'define %Promise* @__Promise_reject_static(i8* %reason) {\n';
    ir += 'entry:\n';
    ir += '  %promise = call %Promise* @__Promise_new()\n';
    ir += '  call void @__Promise_reject(%Promise* %promise, i8* %reason)\n';
    ir += '  ret %Promise* %promise\n';
    ir += '}\n\n';
    return ir;
  }

  generatePromiseAll(): string {
    let ir = '; __Promise_all(%Array* promises) -> %Promise*\n';
    ir += '; Returns a promise that resolves when all input promises resolve\n';
    ir += '; The resolved value is an array of results\n';
    ir += 'define %Promise* @__Promise_all(%Array* %promises) {\n';
    ir += 'entry:\n';
    ir += '  ; Create result promise\n';
    ir += '  %result_promise = call %Promise* @__Promise_new()\n';
    ir += '\n';
    ir += '  ; Get array length\n';
    ir += '  %len_ptr = getelementptr inbounds %Array, %Array* %promises, i32 0, i32 0\n';
    ir += '  %len_double = load double, double* %len_ptr\n';
    ir += '  %len = fptosi double %len_double to i32\n';
    ir += '\n';
    ir += '  ; Check if empty array\n';
    ir += '  %is_empty = icmp eq i32 %len, 0\n';
    ir += '  br i1 %is_empty, label %resolve_empty, label %setup_counter\n';
    ir += '\n';
    ir += 'resolve_empty:\n';
    ir += '  ; Resolve with empty array (cast array to i8*)\n';
    ir += '  %empty_ptr = bitcast %Array* %promises to i8*\n';
    ir += '  call void @__Promise_resolve(%Promise* %result_promise, i8* %empty_ptr)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'setup_counter:\n';
    ir += '  ; Allocate counter and results array\n';
    ir += '  ; Counter: how many promises left to resolve\n';
    ir += '  %counter_mem = call i8* @GC_malloc(i64 4)\n';
    ir += '  %counter = bitcast i8* %counter_mem to i32*\n';
    ir += '  store i32 %len, i32* %counter\n';
    ir += '\n';
    ir += '  ; Results array (store Promise results)\n';
    ir += '  %results_size = mul i32 %len, 8\n';
    ir += '  %results_size_i64 = sext i32 %results_size to i64\n';
    ir += '  %results_mem = call i8* @GC_malloc(i64 %results_size_i64)\n';
    ir += '  %results = bitcast i8* %results_mem to i8**\n';
    ir += '\n';
    ir += '  ; For now, just resolve immediately with the promises array\n';
    ir += '  ; TODO: Set up callbacks for each promise\n';
    ir += '  %arr_ptr = bitcast %Array* %promises to i8*\n';
    ir += '  call void @__Promise_resolve(%Promise* %result_promise, i8* %arr_ptr)\n';
    ir += '  br label %done\n';
    ir += '\n';
    ir += 'done:\n';
    ir += '  ret %Promise* %result_promise\n';
    ir += '}\n\n';
    return ir;
  }

  generateAll(): string {
    let ir = '';
    ir += this.generatePromiseNew();
    ir += this.generatePromiseResolve();
    ir += this.generatePromiseReject();
    ir += this.generatePromiseRunCallbacks();
    ir += this.generatePromiseThen();
    ir += this.generatePromiseResolveStatic();
    ir += this.generatePromiseRejectStatic();
    ir += this.generatePromiseAll();
    return ir;
  }
}

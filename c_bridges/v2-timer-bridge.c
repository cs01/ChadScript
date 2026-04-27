#include <stdlib.h>
#include <stdint.h>
#include <uv.h>

typedef struct {
    void (*fn_ptr)(void* env);
    void* env_ptr;
    int is_interval;
} TimerData;

static void timer_callback(uv_timer_t* handle) {
    TimerData* data = (TimerData*)uv_handle_get_data((uv_handle_t*)handle);
    if (!data) return;
    data->fn_ptr(data->env_ptr);
    if (!data->is_interval) {
        uv_timer_stop(handle);
        uv_close((uv_handle_t*)handle, NULL);
    }
}

void* cs2_set_timeout(void* closure_ptr, double delay_ms) {
    void** closure = (void**)closure_ptr;
    void* fn_ptr = closure[0];
    void* env_ptr = closure[1];

    uv_timer_t* timer = (uv_timer_t*)malloc(sizeof(uv_timer_t));
    uv_timer_init(uv_default_loop(), timer);

    TimerData* data = (TimerData*)malloc(sizeof(TimerData));
    data->fn_ptr = (void (*)(void*))fn_ptr;
    data->env_ptr = env_ptr;
    data->is_interval = 0;

    uv_handle_set_data((uv_handle_t*)timer, data);
    uv_timer_start(timer, timer_callback, (uint64_t)delay_ms, 0);

    return timer;
}

void* cs2_set_interval(void* closure_ptr, double interval_ms) {
    void** closure = (void**)closure_ptr;
    void* fn_ptr = closure[0];
    void* env_ptr = closure[1];

    uv_timer_t* timer = (uv_timer_t*)malloc(sizeof(uv_timer_t));
    uv_timer_init(uv_default_loop(), timer);

    TimerData* data = (TimerData*)malloc(sizeof(TimerData));
    data->fn_ptr = (void (*)(void*))fn_ptr;
    data->env_ptr = env_ptr;
    data->is_interval = 1;

    uv_handle_set_data((uv_handle_t*)timer, data);
    uv_timer_start(timer, timer_callback, (uint64_t)interval_ms, (uint64_t)interval_ms);

    return timer;
}

void cs2_clear_timer(void* timer_handle) {
    if (!timer_handle) return;
    uv_timer_t* timer = (uv_timer_t*)timer_handle;
    uv_timer_stop(timer);
    uv_close((uv_handle_t*)timer, NULL);
}

int cs2_run_event_loop(void) {
    return uv_run(uv_default_loop(), UV_RUN_DEFAULT);
}

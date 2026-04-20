// node-bridge.cc — embed Node.js (libnode) for the `@chadscript: interpret`
// pragma. Replaces the raw-V8 bridge (c_bridges/v8-bridge.cc). Keeping the
// `cs_v8_*` symbol names lets the rest of the compiler pipeline and the 40
// existing C unit tests continue to link unchanged.
//
// Why Node instead of raw V8: we get `require`, `fs`, `Buffer`, `setTimeout`,
// Promise microtasks, and the full Node CJS/ESM module loaders "for free",
// rather than reimplementing each one on top of raw V8. Electron / NW.js
// prove this embedding pattern scales to production.
//
// Lifecycle: the process holds a single `MultiIsolatePlatform` + one
// `CommonEnvironmentSetup` for the interpret pragma's isolate. Each eval
// reuses that environment (required for `require` caching to work).
//
// ABI: all JSHandle functions cross the boundary as `double` (see h2d/d2h).
// ChadScript's `number` FFI lowering reads the integer return register via
// double, so integer-typed handles would read garbage. This matches the
// existing v8-bridge ABI — diff-minimizing swap.

#include <node.h>
#include <node_api.h>
#include <uv.h>
#include <v8.h>

#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

// ---- Global Node embedding state ----

std::unique_ptr<node::MultiIsolatePlatform> g_platform;
std::unique_ptr<node::CommonEnvironmentSetup> g_setup;
v8::Isolate* g_isolate = nullptr;
node::Environment* g_env = nullptr;
bool g_initialized = false;
std::mutex g_init_mu;
std::string g_init_error;

thread_local std::string t_last_error;

// ---- JSHandle table (same layout as v8-bridge) ----

constexpr uint64_t JS_HANDLE_TAG = 0x100000000ULL;
constexpr uint64_t JS_HANDLE_TAG_MASK = 0xFFFFFFFF00000000ULL;
thread_local uint64_t t_next_handle_id = 1;
thread_local std::unordered_map<uint64_t, v8::Global<v8::Value>> t_handles;

inline double h2d(uint64_t h) { return (double)h; }
inline uint64_t d2h(double d) {
    if (d < 0.0 || !std::isfinite(d)) return 0;
    return (uint64_t)d;
}

uint64_t store_handle(v8::Isolate* iso, v8::Local<v8::Value> value) {
    uint64_t id = JS_HANDLE_TAG | (t_next_handle_id++);
    t_handles.emplace(id, v8::Global<v8::Value>(iso, value));
    return id;
}

bool is_handle(uint64_t id) {
    return (id & JS_HANDLE_TAG_MASK) == JS_HANDLE_TAG;
}

// ---- Node lazy init ----

bool cs_node_lazy_init() {
    std::lock_guard<std::mutex> lk(g_init_mu);
    if (g_initialized) return true;
    if (!g_init_error.empty()) {
        t_last_error = g_init_error;
        return false;
    }

    // argv seen by Node. "chad" is the embedder-visible process.argv[0].
    std::vector<std::string> args{"chad"};
    std::vector<std::string> exec_args;
    std::vector<std::string> errors;

    int rc = node::InitializeNodeWithArgs(&args, &exec_args, &errors);
    if (rc != 0 || !errors.empty()) {
        g_init_error = "node::InitializeNodeWithArgs failed";
        for (auto& e : errors) { g_init_error += ": "; g_init_error += e; }
        t_last_error = g_init_error;
        return false;
    }

    g_platform = node::MultiIsolatePlatform::Create(/*thread_pool_size=*/4);
    v8::V8::InitializePlatform(g_platform.get());
    v8::V8::Initialize();

    errors.clear();
    g_setup = node::CommonEnvironmentSetup::Create(
        g_platform.get(), &errors, args, exec_args);
    if (!g_setup) {
        g_init_error = "CommonEnvironmentSetup::Create failed";
        for (auto& e : errors) { g_init_error += ": "; g_init_error += e; }
        t_last_error = g_init_error;
        return false;
    }

    g_isolate = g_setup->isolate();
    g_env = g_setup->env();

    // Bootstrap: minimal script so Node wires up its internals. Real user
    // code is executed later via node::LoadEnvironment-style eval (see
    // cs_v8_eval_string below). An empty bootstrap is valid.
    {
        v8::Locker locker(g_isolate);
        v8::Isolate::Scope iscope(g_isolate);
        v8::HandleScope hs(g_isolate);
        v8::Local<v8::Context> ctx = g_setup->context();
        v8::Context::Scope cscope(ctx);
        v8::MaybeLocal<v8::Value> boot = node::LoadEnvironment(g_env, "");
        if (boot.IsEmpty()) {
            g_init_error = "node::LoadEnvironment(bootstrap) returned empty";
            t_last_error = g_init_error;
            return false;
        }
    }

    g_initialized = true;
    return true;
}

// Runs `src` inside the persistent Node environment. Returns the last
// expression's value via v8::Script::Run; then drains the libuv event loop so
// setTimeout/fs/promises tasks complete before we return.
bool run_script(const char* src, v8::Local<v8::Value>* out_result) {
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch try_catch(g_isolate);

    v8::Local<v8::String> source;
    if (!v8::String::NewFromUtf8(g_isolate, src ? src : "",
                                 v8::NewStringType::kNormal).ToLocal(&source)) {
        t_last_error = "failed to allocate source string";
        return false;
    }

    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(ctx, source).ToLocal(&script)) {
        v8::String::Utf8Value m(g_isolate, try_catch.Exception());
        t_last_error = "compile failed";
        if (*m) { t_last_error += ": "; t_last_error += *m; }
        return false;
    }

    v8::Local<v8::Value> result;
    if (!script->Run(ctx).ToLocal(&result)) {
        v8::String::Utf8Value m(g_isolate, try_catch.Exception());
        t_last_error = "run failed";
        if (*m) { t_last_error += ": "; t_last_error += *m; }
        return false;
    }

    // Drain microtasks + libuv. SpinEventLoop runs until there are no more
    // refs or the loop is stopped — that's what makes setTimeout work.
    node::SpinEventLoop(g_env);

    *out_result = result;
    return true;
}

} // namespace

extern "C" {

double cs_v8_available(void) {
    return cs_node_lazy_init() ? 1.0 : 0.0;
}

const char* cs_v8_last_error(void) {
    return t_last_error.empty() ? "" : t_last_error.c_str();
}

void cs_v8_clear_error(void) {
    t_last_error.clear();
}

double cs_v8_eval_number(const char* src) {
    if (!cs_node_lazy_init()) return std::nan("");
    t_last_error.clear();
    v8::Local<v8::Value> result;
    if (!run_script(src, &result)) return std::nan("");

    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);

    if (!result->IsNumber()) {
        v8::String::Utf8Value got(g_isolate, result);
        t_last_error = "expected number, got: ";
        t_last_error += *got ? *got : "<?>";
        return std::nan("");
    }
    double out;
    if (!result->NumberValue(ctx).To(&out)) {
        t_last_error = "NumberValue conversion failed";
        return std::nan("");
    }
    return out;
}

char* cs_v8_eval_string(const char* src) {
    if (!cs_node_lazy_init()) return nullptr;
    t_last_error.clear();
    v8::Local<v8::Value> result;
    if (!run_script(src, &result)) return nullptr;

    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);

    if (result->IsUndefined() || result->IsNull()) return strdup("");
    v8::Local<v8::String> str;
    if (!result->ToString(ctx).ToLocal(&str)) {
        t_last_error = "ToString failed";
        return nullptr;
    }
    v8::String::Utf8Value utf8(g_isolate, str);
    return strdup(*utf8 ? *utf8 : "");
}

// ---- JSHandle API ----

double cs_v8_eval_handle(const char* src) {
    if (!cs_node_lazy_init()) return 0.0;
    t_last_error.clear();
    v8::Local<v8::Value> result;
    if (!run_script(src, &result)) return 0.0;
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    return h2d(store_handle(g_isolate, result));
}

double cs_v8_handle_to_number(double handle_d) {
    uint64_t handle = d2h(handle_d);
    t_last_error.clear();
    if (!is_handle(handle)) { t_last_error = "not a JSHandle"; return std::nan(""); }
    auto it = t_handles.find(handle);
    if (it == t_handles.end()) { t_last_error = "JSHandle released"; return std::nan(""); }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = it->second.Get(g_isolate);
    if (!val->IsNumber()) { t_last_error = "handle not a number"; return std::nan(""); }
    double out;
    if (!val->NumberValue(ctx).To(&out)) { t_last_error = "NumberValue failed"; return std::nan(""); }
    return out;
}

char* cs_v8_handle_to_string(double handle_d) {
    uint64_t handle = d2h(handle_d);
    t_last_error.clear();
    if (!is_handle(handle)) { t_last_error = "not a JSHandle"; return nullptr; }
    auto it = t_handles.find(handle);
    if (it == t_handles.end()) { t_last_error = "JSHandle released"; return nullptr; }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = it->second.Get(g_isolate);
    v8::Local<v8::String> str;
    if (!val->ToString(ctx).ToLocal(&str)) { t_last_error = "ToString failed"; return nullptr; }
    v8::String::Utf8Value utf8(g_isolate, str);
    return strdup(*utf8 ? *utf8 : "");
}

void cs_v8_handle_release(double handle_d) {
    uint64_t handle = d2h(handle_d);
    if (!is_handle(handle)) return;
    auto it = t_handles.find(handle);
    if (it != t_handles.end()) {
        it->second.Reset();
        t_handles.erase(it);
    }
}

double cs_v8_handle_table_size(void) { return (double)t_handles.size(); }

double cs_v8_is_handle(double value_d) {
    return is_handle(d2h(value_d)) ? 1.0 : 0.0;
}

double cs_v8_make_number_handle(double n) {
    if (!cs_node_lazy_init()) return 0.0;
    t_last_error.clear();
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = v8::Number::New(g_isolate, n);
    return h2d(store_handle(g_isolate, val));
}

double cs_v8_make_string_handle(const char* s) {
    if (!cs_node_lazy_init()) return 0.0;
    t_last_error.clear();
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::String> str;
    if (!v8::String::NewFromUtf8(g_isolate, s ? s : "",
                                 v8::NewStringType::kNormal).ToLocal(&str)) {
        t_last_error = "alloc string failed";
        return 0.0;
    }
    return h2d(store_handle(g_isolate, str));
}

double cs_v8_handle_get_property(double obj_handle_d, const char* name) {
    uint64_t obj_handle = d2h(obj_handle_d);
    t_last_error.clear();
    if (!is_handle(obj_handle)) { t_last_error = "get_property: not a JSHandle"; return 0.0; }
    auto it = t_handles.find(obj_handle);
    if (it == t_handles.end()) { t_last_error = "get_property: released"; return 0.0; }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch tc(g_isolate);
    v8::Local<v8::Value> obj_val = it->second.Get(g_isolate);
    if (!obj_val->IsObject()) { t_last_error = "get_property: not object"; return 0.0; }
    v8::Local<v8::Object> obj = obj_val.As<v8::Object>();
    v8::Local<v8::String> key;
    if (!v8::String::NewFromUtf8(g_isolate, name ? name : "",
                                 v8::NewStringType::kNormal).ToLocal(&key)) {
        t_last_error = "get_property: alloc key failed";
        return 0.0;
    }
    v8::Local<v8::Value> prop;
    if (!obj->Get(ctx, key).ToLocal(&prop)) { t_last_error = "get_property: threw"; return 0.0; }
    return h2d(store_handle(g_isolate, prop));
}

double cs_v8_handle_call(double fn_handle_d,
                         double this_handle_or_zero_d,
                         int32_t n_args,
                         const double* arg_handles) {
    uint64_t fn_handle = d2h(fn_handle_d);
    uint64_t this_handle_or_zero = d2h(this_handle_or_zero_d);
    t_last_error.clear();
    if (!is_handle(fn_handle)) { t_last_error = "call: fn not JSHandle"; return 0.0; }
    auto fn_it = t_handles.find(fn_handle);
    if (fn_it == t_handles.end()) { t_last_error = "call: fn released"; return 0.0; }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch tc(g_isolate);
    v8::Local<v8::Value> fn_val = fn_it->second.Get(g_isolate);
    if (!fn_val->IsFunction()) { t_last_error = "call: not function"; return 0.0; }
    v8::Local<v8::Function> fn = fn_val.As<v8::Function>();

    v8::Local<v8::Value> recv;
    if (this_handle_or_zero == 0) {
        recv = v8::Undefined(g_isolate);
    } else if (!is_handle(this_handle_or_zero)) {
        t_last_error = "call: this not JSHandle"; return 0.0;
    } else {
        auto ti = t_handles.find(this_handle_or_zero);
        if (ti == t_handles.end()) { t_last_error = "call: this released"; return 0.0; }
        recv = ti->second.Get(g_isolate);
    }

    std::vector<v8::Local<v8::Value>> args;
    args.reserve(n_args < 0 ? 0 : (size_t)n_args);
    for (int i = 0; i < n_args; i++) {
        uint64_t ah = d2h(arg_handles[i]);
        if (!is_handle(ah)) { t_last_error = "call: arg not JSHandle"; return 0.0; }
        auto ai = t_handles.find(ah);
        if (ai == t_handles.end()) { t_last_error = "call: arg released"; return 0.0; }
        args.push_back(ai->second.Get(g_isolate));
    }

    v8::Local<v8::Value> result;
    if (!fn->Call(ctx, recv, n_args, args.data()).ToLocal(&result)) {
        t_last_error = "call: threw";
        return 0.0;
    }

    node::SpinEventLoop(g_env);
    return h2d(store_handle(g_isolate, result));
}

} // extern "C"

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

// Captures the last unhandled promise rejection seen in this thread's
// Node environment. Set by the v8 PromiseRejectCallback, consumed and
// cleared by run_script / eval_script_node once SpinEventLoop returns.
// Separate from t_last_error so a caller that already set an error for
// a synchronous throw is not overwritten.
thread_local std::string t_last_unhandled_rejection;

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
    // Use InitializeOncePerProcess (modern API) rather than the deprecated
    // InitializeNodeWithArgs — the deprecated path skips cppgc, v8, and the
    // default Node v8 platform, and reassembling those manually is fragile.
    // kNoDefaultSignalHandling keeps Node from hijacking the chad process's
    // signal handlers (we still want to CTRL-C out of a long eval).
    std::vector<std::string> args{"chad"};
    auto init_result = node::InitializeOncePerProcess(
        args,
        {node::ProcessInitializationFlags::kNoDefaultSignalHandling,
         node::ProcessInitializationFlags::kDisableNodeOptionsEnv,
         node::ProcessInitializationFlags::kDisableCLIOptions});
    if (init_result->early_return()) {
        g_init_error = "node::InitializeOncePerProcess early return";
        for (auto& e : init_result->errors()) {
            g_init_error += ": ";
            g_init_error += e;
        }
        t_last_error = g_init_error;
        return false;
    }

    g_platform.reset(init_result->platform());
    // Ownership: we keep the default platform alive via g_platform. Node's
    // init_result hands us a raw pointer; we take ownership.

    std::vector<std::string> errors;
    std::vector<std::string> exec_args = init_result->exec_args();
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

    // Wire unhandled-promise-rejection hook. V8 fires this for both
    // `kPromiseRejectWithNoHandler` (no .catch ever attached by the end of
    // the microtask queue flush) and `kPromiseHandlerAddedAfterReject`
    // (a late handler — not actually unhandled). We only record the former
    // so a later .catch() doesn't look like a failure.
    g_isolate->SetPromiseRejectCallback(
        [](v8::PromiseRejectMessage msg) {
            if (msg.GetEvent() != v8::kPromiseRejectWithNoHandler) return;
            v8::Isolate* iso = v8::Isolate::GetCurrent();
            if (!iso) return;
            v8::HandleScope hs(iso);
            v8::Local<v8::Value> val = msg.GetValue();
            std::string s = "unhandled promise rejection";
            if (!val.IsEmpty()) {
                v8::String::Utf8Value u(iso, val);
                if (*u) { s += ": "; s += *u; }
            }
            t_last_unhandled_rejection = s;
        });

    // NOTE: We do NOT call LoadEnvironment here. LoadEnvironment can only be
    // called once per Environment; the pragma path calls it later with the
    // real user source. The non-pragma JSHandle API uses v8::Script::Run
    // directly, which does not require LoadEnvironment to have been called.
    g_initialized = true;
    return true;
}

// Track whether LoadEnvironment has been called — it can only fire once per
// Environment. JSHandle-only calls won't trip this; pragma eval_script_node
// sets it.
bool g_load_env_called = false;

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
    // Fresh per-call — stale rejection from an earlier eval must not leak.
    t_last_unhandled_rejection.clear();

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

    // Surface any unhandled promise rejection captured during this run.
    // Without this the rejection is swallowed and the caller thinks the
    // script succeeded. We report it as a run failure so cs_v8_last_error
    // reads it like any other thrown exception.
    if (!t_last_unhandled_rejection.empty()) {
        t_last_error = t_last_unhandled_rejection;
        t_last_unhandled_rejection.clear();
        return false;
    }

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

// Run user source via node::LoadEnvironment(env, src). Unlike raw V8 Script::Run,
// LoadEnvironment wraps the source in Node's CJS wrapper so `require`,
// `__filename`, `__dirname`, `module`, and `exports` are available. Event loop
// is drained before returning so setTimeout/fs.promises finish.
//
// Returns strdup'd stdout-intended string. Empty string if eval value is
// undefined/null. nullptr on failure (caller reads cs_v8_last_error).
//
// NOTE: LoadEnvironment can only be called once per Environment. For the
// pragma use case the file is the whole program, so that's fine. If we ever
// need to eval multiple scripts in sequence we'll need to either (a) recreate
// the env per call, or (b) fall back to Script::Run for the secondary evals.
char* cs_v8_eval_script_node(const char* src, const char* filename) {
    if (!cs_node_lazy_init()) return nullptr;
    t_last_error.clear();
    t_last_unhandled_rejection.clear();

    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch try_catch(g_isolate);

    // Build a preamble that:
    //   1. Sets process.argv[1] so programs inspecting argv see the user script.
    //   2. Replaces the builtin `require` with a CJS-style require created via
    //      `module.createRequire(filename)`. LoadEnvironment's default
    //      `require` is the internal builtin loader — it only resolves
    //      `node:foo` modules, not npm packages / relative paths.
    //   3. Sets __filename / __dirname as globals so user code can read them.
    std::string esc;
    if (filename && *filename) {
        for (const char* p = filename; *p; ++p) {
            if (*p == '\\' || *p == '"') esc.push_back('\\');
            esc.push_back(*p);
        }
    }
    std::string preamble;
    std::string user_prologue;
    if (!esc.empty()) {
        preamble =
            "process.argv[1] = \"" + esc + "\";\n"
            "globalThis.__chad_cjs_require = require('module').createRequire(\"" + esc + "\");\n"
            "globalThis.__filename = \"" + esc + "\";\n"
            "globalThis.__dirname = require('path').dirname(\"" + esc + "\");\n";
        // Inside the CJS wrapper LoadEnvironment injects, `require` is a
        // parameter bound to the internal builtin loader (resolves only
        // `node:*`). Rebind the local name to our CJS-style one so user code
        // that calls `require("some-npm-pkg")` hits the real module resolver.
        user_prologue =
            "require = globalThis.__chad_cjs_require;\n";
    }
    std::string full_src = preamble + user_prologue + (src ? src : "");

    v8::MaybeLocal<v8::Value> maybe = node::LoadEnvironment(g_env, full_src.c_str());
    if (maybe.IsEmpty()) {
        if (try_catch.HasCaught()) {
            v8::String::Utf8Value m(g_isolate, try_catch.Exception());
            t_last_error = "LoadEnvironment threw";
            if (*m) { t_last_error += ": "; t_last_error += *m; }
        } else {
            t_last_error = "LoadEnvironment returned empty";
        }
        return nullptr;
    }

    // Drain microtasks + libuv until the loop is empty (or all handles unref'd).
    // This is what lets setTimeout, fs.promises, async fetch actually finish.
    node::SpinEventLoop(g_env);

    // Surface any unhandled promise rejection captured while the loop ran.
    // Without this, pragma scripts whose top-level flow is a Promise chain
    // with no .catch() would exit silently with undefined behavior.
    if (!t_last_unhandled_rejection.empty()) {
        t_last_error = t_last_unhandled_rejection;
        t_last_unhandled_rejection.clear();
        return nullptr;
    }

    v8::Local<v8::Value> result = maybe.ToLocalChecked();
    if (result->IsUndefined() || result->IsNull()) return strdup("");
    v8::Local<v8::String> str;
    if (!result->ToString(ctx).ToLocal(&str)) {
        t_last_error = "ToString failed on LoadEnvironment result";
        return strdup("");
    }
    v8::String::Utf8Value utf8(g_isolate, str);
    return strdup(*utf8 ? *utf8 : "");
}

// Shut down the Node environment cleanly. The pragma wrapper calls this after
// eval completes so the process can exit — otherwise the isolate + platform
// static state keeps uv handles pinned and main's return hangs in static
// destructors. Safe to call more than once.
void cs_v8_shutdown_node(void) {
    std::lock_guard<std::mutex> lk(g_init_mu);
    if (!g_initialized) return;
    // Drop all outstanding handles first — each v8::Global<Value> pins the
    // isolate. Release them before the isolate itself goes away.
    t_handles.clear();
    if (g_env) {
        node::Stop(g_env);
    }
    g_setup.reset();  // disposes isolate + context + env
    g_isolate = nullptr;
    g_env = nullptr;
    // node::TearDownOncePerProcess disposes V8 + the default platform that
    // InitializeOncePerProcess installed. Releasing g_platform here before
    // TearDown is a no-op (we never owned it — init_result->platform() is
    // the default platform, also owned by Node's per-process state).
    g_platform.release();
    node::TearDownOncePerProcess();
    g_initialized = false;
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

// Ensure the Node environment has the CJS-require bootstrap loaded exactly
// once. Subsequent pragma-module registrations use v8::Script::Run to wrap
// the user source in a CJS IIFE referencing globalThis.__chad_cjs_require.
// Returns true on success; on failure t_last_error is set.
bool ensure_pragma_bootstrap(const char* entry_dir) {
    static bool loaded = false;
    if (loaded) return true;
    if (!cs_node_lazy_init()) return false;
    std::string esc;
    const char* dir = (entry_dir && *entry_dir) ? entry_dir : ".";
    for (const char* p = dir; *p; ++p) {
        if (*p == '\\' || *p == '"') esc.push_back('\\');
        esc.push_back(*p);
    }
    std::string bootstrap =
        "globalThis.__chad_cjs_require = require('module').createRequire("
        "require('path').join(\"" + esc + "\", 'package.json'));\n";
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch try_catch(g_isolate);
    v8::MaybeLocal<v8::Value> maybe = node::LoadEnvironment(g_env, bootstrap.c_str());
    if (maybe.IsEmpty()) {
        if (try_catch.HasCaught()) {
            v8::String::Utf8Value m(g_isolate, try_catch.Exception());
            t_last_error = "pragma bootstrap threw";
            if (*m) { t_last_error += ": "; t_last_error += *m; }
        } else {
            t_last_error = "pragma bootstrap returned empty";
        }
        return false;
    }
    g_load_env_called = true;
    loaded = true;
    return true;
}

// Evaluate the pragma-module source inside an on-the-fly CJS wrapper and
// return a JSHandle to its module.exports object. Multiple modules can be
// registered — each runs in its own closure with its own module/exports.
double cs_v8_register_pragma_module(const char* src, const char* filename) {
    t_last_error.clear();
    if (!ensure_pragma_bootstrap(filename)) return 0.0;

    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::TryCatch tc(g_isolate);

    std::string fesc;
    if (filename && *filename) {
        for (const char* p = filename; *p; ++p) {
            if (*p == '\\' || *p == '"') fesc.push_back('\\');
            fesc.push_back(*p);
        }
    }

    // Wrap user source as: (function(module, exports, require, __filename,
    // __dirname){ USER_SRC; return module.exports; })({exports:{}}, {}, ...)
    // Since JavaScript requires passing module as arg, we build:
    //   (function(){ const module={exports:{}}; const exports=module.exports;
    //     const require=globalThis.__chad_cjs_require;
    //     const __filename="..."; const __dirname=require('path').dirname(__filename);
    //     /* USER_SRC */
    //     return module.exports;
    //   })()
    std::string wrapped;
    wrapped += "(function(){\n";
    wrapped += "const module={exports:{}};\n";
    wrapped += "const exports=module.exports;\n";
    wrapped += "const require=globalThis.__chad_cjs_require;\n";
    if (!fesc.empty()) {
        wrapped += "const __filename=\"" + fesc + "\";\n";
        wrapped += "const __dirname=require('path').dirname(__filename);\n";
    }
    wrapped += (src ? src : "");
    wrapped += "\n;return module.exports;\n})()\n";

    v8::Local<v8::String> source;
    if (!v8::String::NewFromUtf8(g_isolate, wrapped.c_str(),
                                 v8::NewStringType::kNormal).ToLocal(&source)) {
        t_last_error = "register_pragma_module: alloc source failed";
        return 0.0;
    }
    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(ctx, source).ToLocal(&script)) {
        v8::String::Utf8Value m(g_isolate, tc.Exception());
        t_last_error = "register_pragma_module: compile failed";
        if (*m) { t_last_error += ": "; t_last_error += *m; }
        return 0.0;
    }
    v8::Local<v8::Value> result;
    if (!script->Run(ctx).ToLocal(&result)) {
        v8::String::Utf8Value m(g_isolate, tc.Exception());
        t_last_error = "register_pragma_module: run failed";
        if (*m) { t_last_error += ": "; t_last_error += *m; }
        return 0.0;
    }
    node::SpinEventLoop(g_env);
    return h2d(store_handle(g_isolate, result));
}

// Marshal a bool primitive → JSHandle for the argv array.
double cs_v8_make_bool_handle(double b) {
    if (!cs_node_lazy_init()) return 0.0;
    t_last_error.clear();
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = v8::Boolean::New(g_isolate, b != 0.0);
    return h2d(store_handle(g_isolate, val));
}

// Fixed-arity call wrappers — ChadScript's FFI cannot pass a raw `double*`
// array (its `number[]` is a struct). Calling sites up to 8 args cover the
// vast majority of JS APIs; extend with higher arities if needed.
static double call_fixed(double fn_h, double recv_h,
                         const double* args, int32_t n) {
    return cs_v8_handle_call(fn_h, recv_h, n, args);
}
double cs_v8_call0(double fn, double recv) {
    return call_fixed(fn, recv, nullptr, 0);
}
double cs_v8_call1(double fn, double recv, double a0) {
    double a[] = {a0};
    return call_fixed(fn, recv, a, 1);
}
double cs_v8_call2(double fn, double recv, double a0, double a1) {
    double a[] = {a0, a1};
    return call_fixed(fn, recv, a, 2);
}
double cs_v8_call3(double fn, double recv, double a0, double a1, double a2) {
    double a[] = {a0, a1, a2};
    return call_fixed(fn, recv, a, 3);
}
double cs_v8_call4(double fn, double recv, double a0, double a1, double a2,
                   double a3) {
    double a[] = {a0, a1, a2, a3};
    return call_fixed(fn, recv, a, 4);
}
double cs_v8_call5(double fn, double recv, double a0, double a1, double a2,
                   double a3, double a4) {
    double a[] = {a0, a1, a2, a3, a4};
    return call_fixed(fn, recv, a, 5);
}
double cs_v8_call6(double fn, double recv, double a0, double a1, double a2,
                   double a3, double a4, double a5) {
    double a[] = {a0, a1, a2, a3, a4, a5};
    return call_fixed(fn, recv, a, 6);
}
double cs_v8_call7(double fn, double recv, double a0, double a1, double a2,
                   double a3, double a4, double a5, double a6) {
    double a[] = {a0, a1, a2, a3, a4, a5, a6};
    return call_fixed(fn, recv, a, 7);
}
double cs_v8_call8(double fn, double recv, double a0, double a1, double a2,
                   double a3, double a4, double a5, double a6, double a7) {
    double a[] = {a0, a1, a2, a3, a4, a5, a6, a7};
    return call_fixed(fn, recv, a, 8);
}

// If the handle points to a Promise, spin the event loop until it settles
// (fulfilled/rejected) and return a handle to the resolved value (or throw-
// equivalent: set t_last_error and return 0). If the handle is not a Promise,
// return it unchanged. Native `await` across the boundary flows through this.
double cs_v8_handle_await(double handle_d) {
    uint64_t handle = d2h(handle_d);
    t_last_error.clear();
    if (!is_handle(handle)) { t_last_error = "await: not JSHandle"; return 0.0; }
    auto it = t_handles.find(handle);
    if (it == t_handles.end()) { t_last_error = "await: released"; return 0.0; }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = it->second.Get(g_isolate);
    if (!val->IsPromise()) {
        // Nothing to await — re-store & return same value as a fresh handle
        // (the caller expects to own it, matching Promise path semantics).
        return h2d(store_handle(g_isolate, val));
    }
    v8::Local<v8::Promise> promise = val.As<v8::Promise>();
    // Drain microtasks + libuv until the promise is settled. Cap iterations
    // so a never-resolving promise doesn't spin forever silently.
    int iters = 0;
    while (promise->State() == v8::Promise::kPending && iters < 10000) {
        node::SpinEventLoop(g_env);
        iters++;
    }
    if (promise->State() == v8::Promise::kPending) {
        t_last_error = "await: promise pending after 10000 iterations";
        return 0.0;
    }
    v8::Local<v8::Value> resolved = promise->Result();
    if (promise->State() == v8::Promise::kRejected) {
        v8::String::Utf8Value m(g_isolate, resolved);
        t_last_error = "await: promise rejected";
        if (*m) { t_last_error += ": "; t_last_error += *m; }
        return 0.0;
    }
    return h2d(store_handle(g_isolate, resolved));
}

double cs_v8_handle_to_bool(double handle_d) {
    uint64_t handle = d2h(handle_d);
    t_last_error.clear();
    if (!is_handle(handle)) { t_last_error = "to_bool: not JSHandle"; return 0.0; }
    auto it = t_handles.find(handle);
    if (it == t_handles.end()) { t_last_error = "to_bool: released"; return 0.0; }
    v8::Locker locker(g_isolate);
    v8::Isolate::Scope iscope(g_isolate);
    v8::HandleScope hs(g_isolate);
    v8::Local<v8::Context> ctx = g_setup->context();
    v8::Context::Scope cscope(ctx);
    v8::Local<v8::Value> val = it->second.Get(g_isolate);
    return val->BooleanValue(g_isolate) ? 1.0 : 0.0;
}

} // extern "C"

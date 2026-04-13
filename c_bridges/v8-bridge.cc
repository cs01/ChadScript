#include <v8.h>
#include <libplatform/libplatform.h>
#include <cstdlib>
#include <cstring>
#include <string>

static std::unique_ptr<v8::Platform> g_platform;
static v8::Isolate* g_isolate = nullptr;
static v8::Isolate::CreateParams g_create_params;
static bool g_initialized = false;

static void cs_v8_lazy_init(void) {
    if (g_initialized) return;
    v8::V8::InitializeICUDefaultLocation("chad");
    v8::V8::InitializeExternalStartupData("chad");
    g_platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(g_platform.get());
    v8::V8::Initialize();
    g_create_params.array_buffer_allocator =
        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    g_isolate = v8::Isolate::New(g_create_params);
    g_initialized = true;
}

extern "C" {

double cs_v8_available(void) {
    return 1.0;
}

double cs_v8_eval_number(const char* src) {
    cs_v8_lazy_init();
    v8::Isolate::Scope isolate_scope(g_isolate);
    v8::HandleScope handle_scope(g_isolate);
    v8::Local<v8::Context> context = v8::Context::New(g_isolate);
    v8::Context::Scope context_scope(context);

    v8::TryCatch try_catch(g_isolate);

    v8::Local<v8::String> source =
        v8::String::NewFromUtf8(g_isolate, src, v8::NewStringType::kNormal)
            .ToLocalChecked();

    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(context, source).ToLocal(&script)) {
        return 0.0;
    }

    v8::Local<v8::Value> result;
    if (!script->Run(context).ToLocal(&result)) {
        return 0.0;
    }

    if (!result->IsNumber()) {
        return 0.0;
    }
    return result->NumberValue(context).FromMaybe(0.0);
}

char* cs_v8_eval_string(const char* src) {
    cs_v8_lazy_init();
    v8::Isolate::Scope isolate_scope(g_isolate);
    v8::HandleScope handle_scope(g_isolate);
    v8::Local<v8::Context> context = v8::Context::New(g_isolate);
    v8::Context::Scope context_scope(context);

    v8::TryCatch try_catch(g_isolate);

    v8::Local<v8::String> source =
        v8::String::NewFromUtf8(g_isolate, src, v8::NewStringType::kNormal)
            .ToLocalChecked();

    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(context, source).ToLocal(&script)) {
        return strdup("");
    }

    v8::Local<v8::Value> result;
    if (!script->Run(context).ToLocal(&result)) {
        return strdup("");
    }

    v8::String::Utf8Value utf8(g_isolate, result);
    return strdup(*utf8 ? *utf8 : "");
}

}

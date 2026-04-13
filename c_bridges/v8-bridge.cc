#include <v8.h>
#include <libplatform/libplatform.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <string>

static std::unique_ptr<v8::Platform> g_platform;
static v8::Isolate* g_isolate = nullptr;
static v8::Isolate::CreateParams g_create_params;
static bool g_initialized = false;

static thread_local std::string t_last_error;

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

static void native_print_callback(const v8::FunctionCallbackInfo<v8::Value>& args) {
    v8::Isolate* iso = args.GetIsolate();
    v8::HandleScope hs(iso);
    for (int i = 0; i < args.Length(); i++) {
        if (i > 0) fputc(' ', stdout);
        v8::String::Utf8Value s(iso, args[i]);
        fputs(*s ? *s : "<?>", stdout);
    }
    fputc('\n', stdout);
    fflush(stdout);
}

static void install_host_env(v8::Isolate* iso, v8::Local<v8::Context> context) {
    v8::Local<v8::Object> global = context->Global();
    v8::Local<v8::FunctionTemplate> tmpl =
        v8::FunctionTemplate::New(iso, native_print_callback);
    v8::Local<v8::Function> fn;
    if (!tmpl->GetFunction(context).ToLocal(&fn)) return;
    v8::Local<v8::String> print_name =
        v8::String::NewFromUtf8Literal(iso, "print");
    global->Set(context, print_name, fn).Check();

    v8::Local<v8::Object> console_obj = v8::Object::New(iso);
    console_obj->Set(context, v8::String::NewFromUtf8Literal(iso, "log"), fn).Check();
    console_obj->Set(context, v8::String::NewFromUtf8Literal(iso, "error"), fn).Check();
    console_obj->Set(context, v8::String::NewFromUtf8Literal(iso, "warn"), fn).Check();
    global->Set(context,
                v8::String::NewFromUtf8Literal(iso, "console"),
                console_obj).Check();
}

static void set_error_from_trycatch(v8::Isolate* iso,
                                    v8::Local<v8::Context> ctx,
                                    v8::TryCatch& tc,
                                    const char* fallback) {
    if (!tc.HasCaught()) {
        t_last_error = fallback;
        return;
    }
    v8::Local<v8::Value> ex = tc.Exception();
    v8::String::Utf8Value msg(iso, ex);
    const char* m = *msg;
    t_last_error = m ? m : fallback;

    v8::Local<v8::Message> message = tc.Message();
    if (!message.IsEmpty()) {
        v8::Local<v8::String> srcline;
        if (message->GetSourceLine(ctx).ToLocal(&srcline)) {
            v8::String::Utf8Value line(iso, srcline);
            if (*line) {
                t_last_error += " | source: ";
                t_last_error += *line;
            }
        }
    }
}

extern "C" {

double cs_v8_available(void) {
    return 1.0;
}

const char* cs_v8_last_error(void) {
    return t_last_error.empty() ? "" : t_last_error.c_str();
}

void cs_v8_clear_error(void) {
    t_last_error.clear();
}

double cs_v8_eval_number(const char* src) {
    cs_v8_lazy_init();
    t_last_error.clear();
    v8::Isolate::Scope isolate_scope(g_isolate);
    v8::HandleScope handle_scope(g_isolate);
    v8::Local<v8::Context> context = v8::Context::New(g_isolate);
    v8::Context::Scope context_scope(context);
    install_host_env(g_isolate, context);

    v8::TryCatch try_catch(g_isolate);

    v8::Local<v8::String> source;
    if (!v8::String::NewFromUtf8(g_isolate, src, v8::NewStringType::kNormal)
             .ToLocal(&source)) {
        t_last_error = "failed to allocate source string";
        return std::nan("");
    }

    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(context, source).ToLocal(&script)) {
        set_error_from_trycatch(g_isolate, context, try_catch, "compile failed");
        return std::nan("");
    }

    v8::Local<v8::Value> result;
    if (!script->Run(context).ToLocal(&result)) {
        set_error_from_trycatch(g_isolate, context, try_catch, "run failed");
        return std::nan("");
    }

    if (!result->IsNumber()) {
        v8::String::Utf8Value got(g_isolate, result);
        t_last_error = "expected number, got: ";
        t_last_error += *got ? *got : "<unprintable>";
        return std::nan("");
    }

    double out;
    if (!result->NumberValue(context).To(&out)) {
        t_last_error = "NumberValue conversion failed";
        return std::nan("");
    }
    return out;
}

char* cs_v8_eval_string(const char* src) {
    cs_v8_lazy_init();
    t_last_error.clear();
    v8::Isolate::Scope isolate_scope(g_isolate);
    v8::HandleScope handle_scope(g_isolate);
    v8::Local<v8::Context> context = v8::Context::New(g_isolate);
    v8::Context::Scope context_scope(context);
    install_host_env(g_isolate, context);

    v8::TryCatch try_catch(g_isolate);

    v8::Local<v8::String> source;
    if (!v8::String::NewFromUtf8(g_isolate, src, v8::NewStringType::kNormal)
             .ToLocal(&source)) {
        t_last_error = "failed to allocate source string";
        return nullptr;
    }

    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(context, source).ToLocal(&script)) {
        set_error_from_trycatch(g_isolate, context, try_catch, "compile failed");
        return nullptr;
    }

    v8::Local<v8::Value> result;
    if (!script->Run(context).ToLocal(&result)) {
        set_error_from_trycatch(g_isolate, context, try_catch, "run failed");
        return nullptr;
    }

    if (result->IsUndefined() || result->IsNull()) {
        return strdup("");
    }

    v8::Local<v8::String> str;
    if (!result->ToString(context).ToLocal(&str)) {
        set_error_from_trycatch(g_isolate, context, try_catch, "ToString failed");
        return nullptr;
    }

    v8::String::Utf8Value utf8(g_isolate, str);
    return strdup(*utf8 ? *utf8 : "");
}

}

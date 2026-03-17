#include <llvm-c/Core.h>
#include <llvm-c/IRReader.h>
#include <llvm-c/Target.h>
#include <llvm-c/TargetMachine.h>
#include <llvm-c/Transforms/PassBuilder.h>
#include <stdlib.h>
#include <string.h>

static LLVMContextRef g_context = NULL;
static LLVMModuleRef g_module = NULL;
static LLVMTargetMachineRef g_target_machine = NULL;

static int g_targets_initialized = 0;

static void ensure_targets(void) {
    if (g_targets_initialized) return;
    LLVMInitializeX86TargetInfo();
    LLVMInitializeX86Target();
    LLVMInitializeX86TargetMC();
    LLVMInitializeX86AsmPrinter();
    LLVMInitializeX86AsmParser();
    LLVMInitializeAArch64TargetInfo();
    LLVMInitializeAArch64Target();
    LLVMInitializeAArch64TargetMC();
    LLVMInitializeAArch64AsmPrinter();
    LLVMInitializeAArch64AsmParser();
    g_targets_initialized = 1;
}

static void cleanup_module(void) {
    if (g_target_machine) {
        LLVMDisposeTargetMachine(g_target_machine);
        g_target_machine = NULL;
    }
    if (g_module) {
        LLVMDisposeModule(g_module);
        g_module = NULL;
    }
    if (g_context) {
        LLVMContextDispose(g_context);
        g_context = NULL;
    }
}

static char* setup_target(const char* triple,
                          const char* cpu,
                          const char* features) {
    char* default_triple = NULL;
    char* default_cpu = NULL;
    char* default_features = NULL;

    const char* effective_triple = triple;
    if (!effective_triple || effective_triple[0] == '\0') {
        default_triple = LLVMGetDefaultTargetTriple();
        effective_triple = default_triple;
    }

    const char* effective_cpu = cpu;
    if (!effective_cpu || effective_cpu[0] == '\0' ||
        (effective_cpu[0] == 'n' && strcmp(effective_cpu, "native") == 0)) {
        default_cpu = LLVMGetHostCPUName();
        effective_cpu = default_cpu;
    }

    const char* effective_features = features;
    if (!effective_features || effective_features[0] == '\0') {
        default_features = LLVMGetHostCPUFeatures();
        effective_features = default_features;
    }

    LLVMSetTarget(g_module, effective_triple);

    LLVMTargetRef target;
    char* err_msg = NULL;
    if (LLVMGetTargetFromTriple(effective_triple, &target, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "invalid target triple");
        LLVMDisposeMessage(err_msg);
        if (default_triple) LLVMDisposeMessage(default_triple);
        if (default_cpu) LLVMDisposeMessage(default_cpu);
        if (default_features) LLVMDisposeMessage(default_features);
        return result;
    }

    if (g_target_machine) LLVMDisposeTargetMachine(g_target_machine);
    g_target_machine = LLVMCreateTargetMachine(
        target, effective_triple, effective_cpu, effective_features,
        LLVMCodeGenLevelDefault, LLVMRelocDefault, LLVMCodeModelDefault
    );

    if (default_triple) LLVMDisposeMessage(default_triple);
    if (default_cpu) LLVMDisposeMessage(default_cpu);
    if (default_features) LLVMDisposeMessage(default_features);

    if (!g_target_machine) return strdup("failed to create target machine");

    LLVMTargetDataRef data_layout = LLVMCreateTargetDataLayout(g_target_machine);
    LLVMSetModuleDataLayout(g_module, data_layout);
    LLVMDisposeTargetData(data_layout);

    return NULL;
}

static char* run_optimization(int opt_level) {
    if (opt_level <= 0) return NULL;

    const char* passes;
    switch (opt_level) {
        case 1: passes = "default<O1>"; break;
        case 3: passes = "default<O3>"; break;
        default: passes = "default<O2>"; break;
    }

    LLVMPassBuilderOptionsRef opts = LLVMCreatePassBuilderOptions();
    LLVMErrorRef err = LLVMRunPasses(g_module, passes, g_target_machine, opts);
    LLVMDisposePassBuilderOptions(opts);

    if (err) {
        char* msg = LLVMGetErrorMessage(err);
        char* result = strdup(msg);
        LLVMDisposeErrorMessage(msg);
        return result;
    }
    return NULL;
}

static char* emit_object_file(const char* output_path) {
    char* err_msg = NULL;
    if (LLVMTargetMachineEmitToFile(g_target_machine, g_module,
                                     output_path, LLVMObjectFile, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "emit failed");
        LLVMDisposeMessage(err_msg);
        return result;
    }
    return NULL;
}

static char* parse_ir_from_buffer(const char* ir_text, size_t len) {
    cleanup_module();
    g_context = LLVMContextCreate();

    LLVMMemoryBufferRef buf = LLVMCreateMemoryBufferWithMemoryRangeCopy(
        ir_text, len, "input.ll"
    );

    char* err_msg = NULL;
    if (LLVMParseIRInContext(g_context, buf, &g_module, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "unknown parse error");
        LLVMDisposeMessage(err_msg);
        g_context = NULL;
        return result;
    }
    return NULL;
}

char* cs_llvm_compile_ir(const char* ir_text,
                         const char* output_path,
                         double opt_level_d,
                         const char* triple,
                         const char* cpu,
                         const char* features) {
    int opt_level = (int)opt_level_d;
    char* err;
    ensure_targets();

    err = parse_ir_from_buffer(ir_text, strlen(ir_text));
    if (err) return err;

    err = setup_target(triple, cpu, features);
    if (err) { cleanup_module(); return err; }

    err = run_optimization(opt_level);
    if (err) { cleanup_module(); return err; }

    err = emit_object_file(output_path);
    cleanup_module();
    if (err) return err;
    return strdup("");
}

char* cs_llvm_compile_ir_file(const char* ir_file,
                              const char* output_path,
                              double opt_level_d,
                              const char* triple,
                              const char* cpu,
                              const char* features) {
    int opt_level = (int)opt_level_d;
    ensure_targets();

    LLVMMemoryBufferRef file_buf = NULL;
    char* err_msg = NULL;
    if (LLVMCreateMemoryBufferWithContentsOfFile(ir_file, &file_buf, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "failed to read file");
        LLVMDisposeMessage(err_msg);
        return result;
    }

    size_t len = LLVMGetBufferSize(file_buf);
    const char* data = LLVMGetBufferStart(file_buf);

    cleanup_module();
    g_context = LLVMContextCreate();

    LLVMMemoryBufferRef ir_buf = LLVMCreateMemoryBufferWithMemoryRangeCopy(data, len, "input.ll");
    LLVMDisposeMemoryBuffer(file_buf);

    if (LLVMParseIRInContext(g_context, ir_buf, &g_module, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "unknown parse error");
        LLVMDisposeMessage(err_msg);
        g_context = NULL;
        return result;
    }

    char* err;
    err = setup_target(triple, cpu, features);
    if (err) { cleanup_module(); return err; }

    err = run_optimization(opt_level);
    if (err) { cleanup_module(); return err; }

    err = emit_object_file(output_path);
    cleanup_module();
    if (err) return err;
    return strdup("");
}

void cs_llvm_dispose(void) {
    cleanup_module();
}

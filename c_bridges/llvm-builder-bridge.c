#include <llvm-c/Core.h>
#include <llvm-c/IRReader.h>
#include <llvm-c/Target.h>
#include <llvm-c/TargetMachine.h>
#include <llvm-c/Transforms/PassBuilder.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define MAX_VALUES 65536
#define MAX_BLOCKS 8192
#define MAX_TYPES 1024
#define MAX_FUNCS 4096

static LLVMContextRef b_context = NULL;
static LLVMModuleRef b_module = NULL;
static LLVMBuilderRef b_builder = NULL;
static LLVMTargetMachineRef b_target_machine = NULL;

static char* val_names[MAX_VALUES];
static LLVMValueRef val_refs[MAX_VALUES];
static int val_count = 0;

static char* blk_names[MAX_BLOCKS];
static LLVMBasicBlockRef blk_refs[MAX_BLOCKS];
static int blk_count = 0;

static char* type_names[MAX_TYPES];
static LLVMTypeRef type_refs[MAX_TYPES];
static int type_count = 0;

static char* fn_names[MAX_FUNCS];
static LLVMValueRef fn_refs[MAX_FUNCS];
static int fn_count = 0;

static LLVMValueRef current_fn = NULL;
static int temp_counter = 0;

static void register_value(const char* name, LLVMValueRef val) {
    if (val_count >= MAX_VALUES) return;
    val_names[val_count] = strdup(name);
    val_refs[val_count] = val;
    val_count++;
}

static LLVMValueRef lookup_value(const char* name) {
    for (int i = val_count - 1; i >= 0; i--) {
        if (strcmp(val_names[i], name) == 0) return val_refs[i];
    }
    return NULL;
}

static void register_block(const char* name, LLVMBasicBlockRef blk) {
    if (blk_count >= MAX_BLOCKS) return;
    blk_names[blk_count] = strdup(name);
    blk_refs[blk_count] = blk;
    blk_count++;
}

static LLVMBasicBlockRef lookup_block(const char* name) {
    for (int i = blk_count - 1; i >= 0; i--) {
        if (strcmp(blk_names[i], name) == 0) return blk_refs[i];
    }
    return NULL;
}

static void register_type(const char* name, LLVMTypeRef ty) {
    if (type_count >= MAX_TYPES) return;
    type_names[type_count] = strdup(name);
    type_refs[type_count] = ty;
    type_count++;
}

static LLVMTypeRef lookup_type(const char* name);

static LLVMTypeRef parse_type(const char* s) {
    if (!s || !s[0]) return LLVMVoidTypeInContext(b_context);
    if (strcmp(s, "void") == 0) return LLVMVoidTypeInContext(b_context);
    if (strcmp(s, "i1") == 0) return LLVMInt1TypeInContext(b_context);
    if (strcmp(s, "i8") == 0) return LLVMInt8TypeInContext(b_context);
    if (strcmp(s, "i16") == 0) return LLVMInt16TypeInContext(b_context);
    if (strcmp(s, "i32") == 0) return LLVMInt32TypeInContext(b_context);
    if (strcmp(s, "i64") == 0) return LLVMInt64TypeInContext(b_context);
    if (strcmp(s, "double") == 0) return LLVMDoubleTypeInContext(b_context);
    if (strcmp(s, "float") == 0) return LLVMFloatTypeInContext(b_context);

    size_t len = strlen(s);
    if (len > 0 && s[len-1] == '*') {
        char base[256];
        strncpy(base, s, len-1);
        base[len-1] = '\0';
        LLVMTypeRef baseType = parse_type(base);
        return LLVMPointerType(baseType, 0);
    }

    if (s[0] == '%') {
        LLVMTypeRef found = lookup_type(s);
        if (found) return found;
    }

    if (strcmp(s, "i8*") == 0) return LLVMPointerType(LLVMInt8TypeInContext(b_context), 0);
    return LLVMPointerType(LLVMInt8TypeInContext(b_context), 0);
}

static LLVMTypeRef lookup_type(const char* name) {
    for (int i = type_count - 1; i >= 0; i--) {
        if (strcmp(type_names[i], name) == 0) return type_refs[i];
    }
    return NULL;
}

static void register_function(const char* name, LLVMValueRef fn) {
    if (fn_count >= MAX_FUNCS) return;
    fn_names[fn_count] = strdup(name);
    fn_refs[fn_count] = fn;
    fn_count++;
    register_value(name, fn);
}

static LLVMValueRef lookup_function(const char* name) {
    for (int i = fn_count - 1; i >= 0; i--) {
        if (strcmp(fn_names[i], name) == 0) return fn_refs[i];
    }
    const char* lookup = name;
    if (name[0] == '@') lookup = name + 1;
    LLVMValueRef fn = LLVMGetNamedFunction(b_module, lookup);
    return fn;
}

static void clear_function_state(void) {
    for (int i = 0; i < val_count; i++) free(val_names[i]);
    val_count = 0;
    for (int i = 0; i < blk_count; i++) free(blk_names[i]);
    blk_count = 0;
    temp_counter = 0;
}

static char temp_buf[32];
static char* next_temp(void) {
    snprintf(temp_buf, sizeof(temp_buf), "%%%d", temp_counter++);
    return temp_buf;
}

// ============ Module lifecycle ============

char* cs_llvm_builder_init(const char* mod_name, const char* triple,
                           const char* cpu, const char* features) {
    if (b_context) {
        if (b_builder) LLVMDisposeBuilder(b_builder);
        if (b_target_machine) LLVMDisposeTargetMachine(b_target_machine);
        if (b_module) LLVMDisposeModule(b_module);
        LLVMContextDispose(b_context);
    }

    for (int i = 0; i < val_count; i++) free(val_names[i]);
    val_count = 0;
    for (int i = 0; i < blk_count; i++) free(blk_names[i]);
    blk_count = 0;
    for (int i = 0; i < type_count; i++) free(type_names[i]);
    type_count = 0;
    for (int i = 0; i < fn_count; i++) free(fn_names[i]);
    fn_count = 0;
    temp_counter = 0;
    current_fn = NULL;

    b_context = LLVMContextCreate();
    b_module = LLVMModuleCreateWithNameInContext(mod_name, b_context);
    b_builder = LLVMCreateBuilderInContext(b_context);

    LLVMInitializeX86TargetInfo();
    LLVMInitializeX86Target();
    LLVMInitializeX86TargetMC();
    LLVMInitializeX86AsmPrinter();
    LLVMInitializeAArch64TargetInfo();
    LLVMInitializeAArch64Target();
    LLVMInitializeAArch64TargetMC();
    LLVMInitializeAArch64AsmPrinter();

    char* default_triple = NULL;
    char* default_cpu = NULL;
    char* default_features = NULL;

    const char* eff_triple = triple;
    if (!eff_triple || eff_triple[0] == '\0') {
        default_triple = LLVMGetDefaultTargetTriple();
        eff_triple = default_triple;
    }
    const char* eff_cpu = cpu;
    if (!eff_cpu || eff_cpu[0] == '\0' || strcmp(eff_cpu, "native") == 0) {
        default_cpu = LLVMGetHostCPUName();
        eff_cpu = default_cpu;
    }
    const char* eff_features = features;
    if (!eff_features || eff_features[0] == '\0') {
        default_features = LLVMGetHostCPUFeatures();
        eff_features = default_features;
    }

    LLVMSetTarget(b_module, eff_triple);

    LLVMTargetRef target;
    char* err_msg = NULL;
    if (LLVMGetTargetFromTriple(eff_triple, &target, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "invalid triple");
        LLVMDisposeMessage(err_msg);
        if (default_triple) LLVMDisposeMessage(default_triple);
        if (default_cpu) LLVMDisposeMessage(default_cpu);
        if (default_features) LLVMDisposeMessage(default_features);
        return result;
    }

    b_target_machine = LLVMCreateTargetMachine(
        target, eff_triple, eff_cpu, eff_features,
        LLVMCodeGenLevelDefault, LLVMRelocDefault, LLVMCodeModelDefault);

    if (default_triple) LLVMDisposeMessage(default_triple);
    if (default_cpu) LLVMDisposeMessage(default_cpu);
    if (default_features) LLVMDisposeMessage(default_features);

    if (!b_target_machine) return strdup("failed to create target machine");

    LLVMTargetDataRef dl = LLVMCreateTargetDataLayout(b_target_machine);
    LLVMSetModuleDataLayout(b_module, dl);
    LLVMDisposeTargetData(dl);

    return strdup("");
}

void cs_llvm_builder_dispose(void) {
    if (b_builder) { LLVMDisposeBuilder(b_builder); b_builder = NULL; }
    if (b_target_machine) { LLVMDisposeTargetMachine(b_target_machine); b_target_machine = NULL; }
    if (b_module) { LLVMDisposeModule(b_module); b_module = NULL; }
    if (b_context) { LLVMContextDispose(b_context); b_context = NULL; }

    for (int i = 0; i < val_count; i++) free(val_names[i]);
    val_count = 0;
    for (int i = 0; i < blk_count; i++) free(blk_names[i]);
    blk_count = 0;
    for (int i = 0; i < type_count; i++) free(type_names[i]);
    type_count = 0;
    for (int i = 0; i < fn_count; i++) free(fn_names[i]);
    fn_count = 0;
}

// ============ Types ============

void cs_llvm_add_struct_type(const char* name, const char* field_types_csv,
                              double field_count_d) {
    int field_count = (int)field_count_d;
    LLVMTypeRef fields[64];

    char buf[2048];
    strncpy(buf, field_types_csv, sizeof(buf)-1);
    buf[sizeof(buf)-1] = '\0';

    int idx = 0;
    char* tok = strtok(buf, ",");
    while (tok && idx < field_count && idx < 64) {
        while (*tok == ' ') tok++;
        fields[idx++] = parse_type(tok);
        tok = strtok(NULL, ",");
    }

    LLVMTypeRef st = LLVMStructCreateNamed(b_context, name + 1);
    LLVMStructSetBody(st, fields, idx, 0);
    register_type(name, st);
}

// ============ Globals ============

char* cs_llvm_add_global_string(const char* name, const char* value, double len_d) {
    int len = (int)len_d;
    LLVMValueRef gs = LLVMAddGlobal(b_module,
        LLVMArrayType(LLVMInt8TypeInContext(b_context), len + 1), name);
    LLVMSetLinkage(gs, LLVMPrivateLinkage);
    LLVMSetGlobalConstant(gs, 1);
    LLVMSetUnnamedAddress(gs, LLVMGlobalUnnamedAddr);
    LLVMValueRef init = LLVMConstStringInContext(b_context, value, len, 0);
    LLVMSetInitializer(gs, init);
    register_value(name, gs);
    return strdup(name);
}

// ============ Functions ============

void cs_llvm_add_function(const char* name, const char* ret_type_str,
                           const char* param_types_csv, double param_count_d) {
    int param_count = (int)param_count_d;
    LLVMTypeRef params[64];

    if (param_count > 0 && param_types_csv[0]) {
        char buf[2048];
        strncpy(buf, param_types_csv, sizeof(buf)-1);
        buf[sizeof(buf)-1] = '\0';
        int idx = 0;
        char* tok = strtok(buf, ",");
        while (tok && idx < param_count && idx < 64) {
            while (*tok == ' ') tok++;
            params[idx++] = parse_type(tok);
            tok = strtok(NULL, ",");
        }
        param_count = idx;
    }

    LLVMTypeRef ret = parse_type(ret_type_str);
    LLVMTypeRef fn_type = LLVMFunctionType(ret, params, param_count, 0);
    LLVMValueRef fn = LLVMAddFunction(b_module, name, fn_type);
    register_function(name, fn);
}

void cs_llvm_add_extern(const char* name, const char* ret_type_str,
                         const char* param_types_csv, double param_count_d) {
    cs_llvm_add_function(name, ret_type_str, param_types_csv, param_count_d);
}

void cs_llvm_fn_begin(const char* name) {
    clear_function_state();
    current_fn = lookup_function(name);
}

void cs_llvm_fn_end(void) {
    current_fn = NULL;
}

void cs_llvm_fn_set_param_name(double idx_d, const char* name) {
    int idx = (int)idx_d;
    if (!current_fn) return;
    LLVMValueRef param = LLVMGetParam(current_fn, idx);
    LLVMSetValueName2(param, name, strlen(name));
    register_value(name, param);
}

// ============ Basic blocks ============

void cs_llvm_bb_create(const char* name) {
    if (!current_fn) return;
    LLVMBasicBlockRef bb = LLVMAppendBasicBlockInContext(b_context, current_fn, name);
    register_block(name, bb);
}

void cs_llvm_bb_position(const char* name) {
    LLVMBasicBlockRef bb = lookup_block(name);
    if (bb) LLVMPositionBuilderAtEnd(b_builder, bb);
}

// ============ Builder instructions ============

char* cs_llvm_build_store(const char* type_str, const char* value_name, const char* ptr_name) {
    LLVMValueRef val = lookup_value(value_name);
    LLVMValueRef ptr = lookup_value(ptr_name);
    if (!val || !ptr) return strdup("");
    LLVMBuildStore(b_builder, val, ptr);
    return strdup("");
}

char* cs_llvm_build_load(const char* type_str, const char* ptr_name) {
    LLVMValueRef ptr = lookup_value(ptr_name);
    if (!ptr) return strdup("");
    LLVMTypeRef ty = parse_type(type_str);
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildLoad2(b_builder, ty, ptr, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_gep(const char* base_type_str, const char* ptr_name,
                         const char* indices_csv, double count_d) {
    int count = (int)count_d;
    LLVMValueRef ptr = lookup_value(ptr_name);
    if (!ptr) return strdup("");

    LLVMValueRef indices[16];
    char buf[512];
    strncpy(buf, indices_csv, sizeof(buf)-1);
    buf[sizeof(buf)-1] = '\0';
    int idx = 0;
    char* tok = strtok(buf, ",");
    while (tok && idx < count && idx < 16) {
        while (*tok == ' ') tok++;
        if (tok[0] == '%') {
            indices[idx] = lookup_value(tok);
        } else {
            long val = strtol(tok, NULL, 10);
            if (strncmp(tok, "i64 ", 4) == 0) {
                val = strtol(tok + 4, NULL, 10);
                indices[idx] = LLVMConstInt(LLVMInt64TypeInContext(b_context), val, 0);
            } else {
                indices[idx] = LLVMConstInt(LLVMInt32TypeInContext(b_context), val, 0);
            }
        }
        idx++;
        tok = strtok(NULL, ",");
    }

    LLVMTypeRef base = parse_type(base_type_str);
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildGEP2(b_builder, base, ptr, indices, idx, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_call(const char* ret_type_str, const char* func_name,
                          const char* args_csv, double arg_count_d) {
    int arg_count = (int)arg_count_d;
    LLVMValueRef func = lookup_function(func_name);
    if (!func) return strdup("");

    LLVMValueRef args[32];
    if (arg_count > 0 && args_csv[0]) {
        char buf[2048];
        strncpy(buf, args_csv, sizeof(buf)-1);
        buf[sizeof(buf)-1] = '\0';
        int idx = 0;
        char* tok = strtok(buf, ",");
        while (tok && idx < arg_count && idx < 32) {
            while (*tok == ' ') tok++;
            char* space = strchr(tok, ' ');
            const char* val_name = space ? space + 1 : tok;
            args[idx] = lookup_value(val_name);
            if (!args[idx]) {
                if (strncmp(val_name, "null", 4) == 0) {
                    args[idx] = LLVMConstNull(LLVMPointerType(LLVMInt8TypeInContext(b_context), 0));
                } else {
                    double dval = strtod(val_name, NULL);
                    args[idx] = LLVMConstReal(LLVMDoubleTypeInContext(b_context), dval);
                }
            }
            idx++;
            tok = strtok(NULL, ",");
        }
        arg_count = idx;
    }

    LLVMTypeRef fn_ty = LLVMGlobalGetValueType(func);
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildCall2(b_builder, fn_ty, func, args, arg_count, name + 1);
    register_value(name, result);
    return strdup(name);
}

void cs_llvm_build_call_void(const char* func_name, const char* args_csv, double arg_count_d) {
    int arg_count = (int)arg_count_d;
    LLVMValueRef func = lookup_function(func_name);
    if (!func) return;

    LLVMValueRef args[32];
    if (arg_count > 0 && args_csv[0]) {
        char buf[2048];
        strncpy(buf, args_csv, sizeof(buf)-1);
        buf[sizeof(buf)-1] = '\0';
        int idx = 0;
        char* tok = strtok(buf, ",");
        while (tok && idx < arg_count && idx < 32) {
            while (*tok == ' ') tok++;
            char* space = strchr(tok, ' ');
            const char* val_name = space ? space + 1 : tok;
            args[idx] = lookup_value(val_name);
            if (!args[idx]) {
                args[idx] = LLVMConstNull(LLVMPointerType(LLVMInt8TypeInContext(b_context), 0));
            }
            idx++;
            tok = strtok(NULL, ",");
        }
        arg_count = idx;
    }

    LLVMTypeRef fn_ty = LLVMGlobalGetValueType(func);
    LLVMBuildCall2(b_builder, fn_ty, func, args, arg_count, "");
}

char* cs_llvm_build_bitcast(const char* val_name, const char* from_type_str, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    LLVMTypeRef to = parse_type(to_type_str);
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildBitCast(b_builder, val, to, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_icmp(const char* pred_str, const char* type_str,
                          const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");

    LLVMIntPredicate pred = LLVMIntEQ;
    if (strcmp(pred_str, "eq") == 0) pred = LLVMIntEQ;
    else if (strcmp(pred_str, "ne") == 0) pred = LLVMIntNE;
    else if (strcmp(pred_str, "sgt") == 0) pred = LLVMIntSGT;
    else if (strcmp(pred_str, "sge") == 0) pred = LLVMIntSGE;
    else if (strcmp(pred_str, "slt") == 0) pred = LLVMIntSLT;
    else if (strcmp(pred_str, "sle") == 0) pred = LLVMIntSLE;
    else if (strcmp(pred_str, "ugt") == 0) pred = LLVMIntUGT;
    else if (strcmp(pred_str, "uge") == 0) pred = LLVMIntUGE;
    else if (strcmp(pred_str, "ult") == 0) pred = LLVMIntULT;
    else if (strcmp(pred_str, "ule") == 0) pred = LLVMIntULE;

    char* name = next_temp();
    LLVMValueRef result = LLVMBuildICmp(b_builder, pred, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ Terminators ============

void cs_llvm_build_ret(const char* type_str, const char* val_name) {
    LLVMValueRef val = lookup_value(val_name);
    if (val) LLVMBuildRet(b_builder, val);
}

void cs_llvm_build_ret_void(void) {
    LLVMBuildRetVoid(b_builder);
}

void cs_llvm_build_br(const char* label) {
    LLVMBasicBlockRef bb = lookup_block(label);
    if (bb) LLVMBuildBr(b_builder, bb);
}

void cs_llvm_build_br_cond(const char* cond_name, const char* then_label, const char* else_label) {
    LLVMValueRef cond = lookup_value(cond_name);
    LLVMBasicBlockRef then_bb = lookup_block(then_label);
    LLVMBasicBlockRef else_bb = lookup_block(else_label);
    if (cond && then_bb && else_bb)
        LLVMBuildCondBr(b_builder, cond, then_bb, else_bb);
}

void cs_llvm_build_unreachable(void) {
    LLVMBuildUnreachable(b_builder);
}

// ============ Alloca ============

char* cs_llvm_build_alloca(const char* type_str, const char* name) {
    LLVMTypeRef ty = parse_type(type_str);
    LLVMValueRef result = LLVMBuildAlloca(b_builder, ty, name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ Arithmetic ============

char* cs_llvm_build_add(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildAdd(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_sub(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSub(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_mul(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildMul(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_and(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildAnd(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_or(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildOr(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_xor(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildXor(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_shl(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildShl(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_ashr(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildAShr(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_lshr(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildLShr(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fadd(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFAdd(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fsub(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFSub(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fmul(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFMul(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fdiv(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFDiv(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_srem(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSRem(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_sdiv(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSDiv(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_udiv(const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildUDiv(b_builder, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ Casts ============

char* cs_llvm_build_zext(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildZExt(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_sext(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSExt(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_trunc(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildTrunc(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_sitofp(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSIToFP(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fptosi(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFPToSI(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_uitofp(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildUIToFP(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fptrunc(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFPTrunc(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_fpext(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFPExt(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_ptrtoint(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildPtrToInt(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

char* cs_llvm_build_inttoptr(const char* val_name, const char* to_type_str) {
    LLVMValueRef val = lookup_value(val_name);
    if (!val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildIntToPtr(b_builder, val, parse_type(to_type_str), name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ Float comparison ============

char* cs_llvm_build_fcmp(const char* pred_str, const char* lhs_name, const char* rhs_name) {
    LLVMValueRef lhs = lookup_value(lhs_name);
    LLVMValueRef rhs = lookup_value(rhs_name);
    if (!lhs || !rhs) return strdup("");

    LLVMRealPredicate pred = LLVMRealOEQ;
    if (strcmp(pred_str, "oeq") == 0) pred = LLVMRealOEQ;
    else if (strcmp(pred_str, "one") == 0) pred = LLVMRealONE;
    else if (strcmp(pred_str, "ogt") == 0) pred = LLVMRealOGT;
    else if (strcmp(pred_str, "oge") == 0) pred = LLVMRealOGE;
    else if (strcmp(pred_str, "olt") == 0) pred = LLVMRealOLT;
    else if (strcmp(pred_str, "ole") == 0) pred = LLVMRealOLE;
    else if (strcmp(pred_str, "une") == 0) pred = LLVMRealUNE;
    else if (strcmp(pred_str, "ueq") == 0) pred = LLVMRealUEQ;
    else if (strcmp(pred_str, "ord") == 0) pred = LLVMRealORD;
    else if (strcmp(pred_str, "uno") == 0) pred = LLVMRealUNO;

    char* name = next_temp();
    LLVMValueRef result = LLVMBuildFCmp(b_builder, pred, lhs, rhs, name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ PHI / Select ============

char* cs_llvm_build_phi(const char* type_str, const char* vals_csv,
                         const char* blocks_csv, double count_d) {
    int count = (int)count_d;
    LLVMTypeRef ty = parse_type(type_str);
    char* name = next_temp();
    LLVMValueRef phi = LLVMBuildPhi(b_builder, ty, name + 1);

    LLVMValueRef vals[16];
    LLVMBasicBlockRef blocks[16];

    char vbuf[1024], bbuf[1024];
    strncpy(vbuf, vals_csv, sizeof(vbuf)-1); vbuf[sizeof(vbuf)-1] = '\0';
    strncpy(bbuf, blocks_csv, sizeof(bbuf)-1); bbuf[sizeof(bbuf)-1] = '\0';

    char* vtok = strtok(vbuf, ",");
    int vi = 0;
    while (vtok && vi < count && vi < 16) {
        while (*vtok == ' ') vtok++;
        vals[vi] = lookup_value(vtok);
        vi++;
        vtok = strtok(NULL, ",");
    }

    char* btok = strtok(bbuf, ",");
    int bi = 0;
    while (btok && bi < count && bi < 16) {
        while (*btok == ' ') btok++;
        blocks[bi] = lookup_block(btok);
        bi++;
        btok = strtok(NULL, ",");
    }

    int actual = vi < bi ? vi : bi;
    if (actual > 0) LLVMAddIncoming(phi, vals, blocks, actual);

    register_value(name, phi);
    return strdup(name);
}

char* cs_llvm_build_select(const char* cond_name, const char* then_name, const char* else_name) {
    LLVMValueRef cond = lookup_value(cond_name);
    LLVMValueRef then_val = lookup_value(then_name);
    LLVMValueRef else_val = lookup_value(else_name);
    if (!cond || !then_val || !else_val) return strdup("");
    char* name = next_temp();
    LLVMValueRef result = LLVMBuildSelect(b_builder, cond, then_val, else_val, name + 1);
    register_value(name, result);
    return strdup(name);
}

// ============ Output ============

char* cs_llvm_builder_optimize(double level_d) {
    int level = (int)level_d;
    if (level <= 0) return strdup("");

    const char* passes;
    switch (level) {
        case 1: passes = "default<O1>"; break;
        case 3: passes = "default<O3>"; break;
        default: passes = "default<O2>"; break;
    }

    LLVMPassBuilderOptionsRef opts = LLVMCreatePassBuilderOptions();
    LLVMErrorRef err = LLVMRunPasses(b_module, passes, b_target_machine, opts);
    LLVMDisposePassBuilderOptions(opts);

    if (err) {
        char* msg = LLVMGetErrorMessage(err);
        char* result = strdup(msg);
        LLVMDisposeErrorMessage(msg);
        return result;
    }
    return strdup("");
}

char* cs_llvm_builder_emit_object(const char* output_path) {
    char* err_msg = NULL;
    if (LLVMTargetMachineEmitToFile(b_target_machine, b_module,
                                     output_path, LLVMObjectFile, &err_msg)) {
        char* result = strdup(err_msg ? err_msg : "emit failed");
        LLVMDisposeMessage(err_msg);
        return result;
    }
    return strdup("");
}

char* cs_llvm_builder_print(const char* output_path) {
    char* ir = LLVMPrintModuleToString(b_module);
    if (!ir) return strdup("failed to print module");
    FILE* f = fopen(output_path, "w");
    if (!f) { LLVMDisposeMessage(ir); return strdup("failed to open file"); }
    fputs(ir, f);
    fclose(f);
    LLVMDisposeMessage(ir);
    return strdup("");
}

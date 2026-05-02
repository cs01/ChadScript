#include <stdio.h>
#include <llvm-c/Core.h>
#include <llvm-c/TargetMachine.h>
#include <llvm-c/Target.h>
#include <llvm-c/DebugInfo.h>
#include <llvm-c/Transforms/PassBuilder.h>
#include <llvm-c/Error.h>
#include <llvm-c/Analysis.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct { void **data; int32_t length; int32_t capacity; } cs2_StrArray;

void **cs2_str_array_data(void *arr) {
    return ((cs2_StrArray *)arr)->data;
}

int32_t cs2_str_array_length_fast(void *arr) {
    return ((cs2_StrArray *)arr)->length;
}

/* ---- functions with out params ---- */

void *chad2_LLVMGetTargetFromTriple(const char *triple) {
    LLVMTargetRef target = NULL;
    char *err = NULL;
    LLVMGetTargetFromTriple(triple, &target, &err);
    if (err) LLVMDisposeMessage(err);
    return (void *)target;
}

int chad2_LLVMPrintModuleToFile(void *mod, const char *filename) {
    char *err = NULL;
    int r = LLVMPrintModuleToFile((LLVMModuleRef)mod, (char *)filename, &err);
    if (err) LLVMDisposeMessage(err);
    return r;
}

int chad2_LLVMTargetMachineEmitToFile(void *tm, void *mod, const char *filename, double type) {
    char *err = NULL;
    int r = LLVMTargetMachineEmitToFile(
        (LLVMTargetMachineRef)tm, (LLVMModuleRef)mod,
        (char *)filename, (LLVMCodeGenFileType)(int)type, &err);
    if (err) LLVMDisposeMessage(err);
    return r;
}

int chad2_LLVMRunPasses(void *mod, const char *passes, void *tm) {
    LLVMPassBuilderOptionsRef opts = LLVMCreatePassBuilderOptions();
    LLVMErrorRef err = LLVMRunPasses((LLVMModuleRef)mod, passes, (LLVMTargetMachineRef)tm, opts);
    LLVMDisposePassBuilderOptions(opts);
    if (err) {
        char *msg = LLVMGetErrorMessage(err);
        LLVMConsumeError(err);
        LLVMDisposeMessage(msg);
        return 1;
    }
    return 0;
}

/* ---- integer-param wrappers (number = f64 in ChadScript) ---- */

void *chad2_LLVMPointerTypeInContext(void *ctx, double addrSpace) {
    return (void *)LLVMPointerTypeInContext((LLVMContextRef)ctx, (unsigned)addrSpace);
}

void *chad2_LLVMConstInt(void *type, double hi32, double lo32, double signExtend) {
    uint64_t val = ((uint64_t)(uint32_t)(unsigned long long)hi32 << 32) | (uint32_t)(unsigned long long)lo32;
    return (void *)LLVMConstInt((LLVMTypeRef)type, val, (LLVMBool)(int)signExtend);
}

void *chad2_LLVMConstReal(void *type, double val) {
    return (void *)LLVMConstReal((LLVMTypeRef)type, val);
}

void *chad2_LLVMArrayType2(void *elemType, double count) {
    return (void *)LLVMArrayType2((LLVMTypeRef)elemType, (uint64_t)count);
}

void *chad2_LLVMGetParam(void *fn, double index) {
    return (void *)LLVMGetParam((LLVMValueRef)fn, (unsigned)index);
}

void *chad2_LLVMAppendBasicBlockInContext(void *ctx, void *fn, const char *name) {
    return (void *)LLVMAppendBasicBlockInContext(
        (LLVMContextRef)ctx, (LLVMValueRef)fn, name);
}

void chad2_LLVMSetLinkage(void *val, double linkage) {
    LLVMSetLinkage((LLVMValueRef)val, (LLVMLinkage)(int)linkage);
}

void *chad2_LLVMBuildICmp(void *b, double op, void *lhs, void *rhs, const char *name) {
    return (void *)LLVMBuildICmp(
        (LLVMBuilderRef)b, (LLVMIntPredicate)(int)op,
        (LLVMValueRef)lhs, (LLVMValueRef)rhs, name);
}

void *chad2_LLVMBuildFCmp(void *b, double op, void *lhs, void *rhs, const char *name) {
    return (void *)LLVMBuildFCmp(
        (LLVMBuilderRef)b, (LLVMRealPredicate)(int)op,
        (LLVMValueRef)lhs, (LLVMValueRef)rhs, name);
}

void *chad2_LLVMBuildExtractValue(void *b, void *agg, double idx, const char *name) {
    return (void *)LLVMBuildExtractValue(
        (LLVMBuilderRef)b, (LLVMValueRef)agg, (unsigned)idx, name);
}

void *chad2_LLVMBuildInsertValue(void *b, void *agg, void *elt, double idx, const char *name) {
    return (void *)LLVMBuildInsertValue(
        (LLVMBuilderRef)b, (LLVMValueRef)agg, (LLVMValueRef)elt, (unsigned)idx, name);
}

/* ---- RefArr param wrappers ---- */

void *chad2_LLVMFunctionType(void *ret, void **params, double numParams, double isVarArg) {
    return (void *)LLVMFunctionType(
        (LLVMTypeRef)ret, (LLVMTypeRef *)params, (unsigned)numParams, (LLVMBool)(int)isVarArg);
}

void chad2_LLVMStructSetBody(void *type, void **elems, double count, double packed) {
    LLVMStructSetBody(
        (LLVMTypeRef)type, (LLVMTypeRef *)elems, (unsigned)count, (LLVMBool)(int)packed);
}

void *chad2_LLVMConstArray2(void *elemType, void **vals, double count) {
    return (void *)LLVMConstArray2(
        (LLVMTypeRef)elemType, (LLVMValueRef *)vals, (uint64_t)count);
}

void *chad2_LLVMConstNamedStruct(void *type, void **vals, double count) {
    return (void *)LLVMConstNamedStruct(
        (LLVMTypeRef)type, (LLVMValueRef *)vals, (unsigned)count);
}

void *chad2_LLVMBuildCall2(void *b, void *fnType, void *fn, void **args, double numArgs, const char *name) {
    return (void *)LLVMBuildCall2(
        (LLVMBuilderRef)b, (LLVMTypeRef)fnType, (LLVMValueRef)fn,
        (LLVMValueRef *)args, (unsigned)numArgs, name);
}

void chad2_LLVMAddIncoming(void *phi, void **vals, void **blocks, double count) {
    LLVMAddIncoming(
        (LLVMValueRef)phi, (LLVMValueRef *)vals, (LLVMBasicBlockRef *)blocks, (unsigned)count);
}

void *chad2_LLVMBuildInBoundsGEP2(void *b, void *type, void *ptr, void **indices, double numIndices, const char *name) {
    return (void *)LLVMBuildInBoundsGEP2(
        (LLVMBuilderRef)b, (LLVMTypeRef)type, (LLVMValueRef)ptr,
        (LLVMValueRef *)indices, (unsigned)numIndices, name);
}

/* ---- enum attribute helpers ---- */

double chad2_LLVMGetEnumAttributeKindForName(const char *name) {
    return (double)LLVMGetEnumAttributeKindForName(name, strlen(name));
}

void *chad2_LLVMCreateEnumAttribute(void *ctx, double kind, double val) {
    return (void *)LLVMCreateEnumAttribute(
        (LLVMContextRef)ctx, (unsigned)kind, (uint64_t)val);
}

void chad2_LLVMAddAttributeAtIndex(void *fn, double idx, void *attr) {
    LLVMAddAttributeAtIndex((LLVMValueRef)fn, (LLVMAttributeIndex)(unsigned)idx, (LLVMAttributeRef)attr);
}

/* ---- module flags ---- */

void chad2_LLVMAddModuleFlag(void *mod, double behavior, const char *key, double val_i, void *metadata) {
    LLVMAddModuleFlag(
        (LLVMModuleRef)mod, (LLVMModuleFlagBehavior)(int)behavior,
        key, strlen(key), (LLVMMetadataRef)metadata);
}

/* ---- DI builder (simplified, no size_t string lengths needed from ChadScript) ---- */

void *chad2_LLVMDIBuilderCreateFile(void *builder, const char *filename, const char *directory) {
    return (void *)LLVMDIBuilderCreateFile(
        (LLVMDIBuilderRef)builder,
        filename, strlen(filename),
        directory, strlen(directory));
}

void *chad2_LLVMDIBuilderCreateCompileUnit(void *builder, double lang, void *file,
    const char *producer, double isOptimized, double runtimeVer) {
    return (void *)LLVMDIBuilderCreateCompileUnit(
        (LLVMDIBuilderRef)builder, (LLVMDWARFSourceLanguage)(unsigned)lang,
        (LLVMMetadataRef)file, producer, strlen(producer),
        (LLVMBool)(int)isOptimized, "", 0,
        (unsigned)runtimeVer, "", 0,
        LLVMDWARFEmissionFull, 0, 0, 0, "", 0, "", 0);
}

void *chad2_LLVMDIBuilderCreateSubroutineType(void *builder, void *file, void **paramTypes, double numParams) {
    return (void *)LLVMDIBuilderCreateSubroutineType(
        (LLVMDIBuilderRef)builder, (LLVMMetadataRef)file,
        (LLVMMetadataRef *)paramTypes, (unsigned)numParams, 0);
}

void *chad2_LLVMDIBuilderCreateFunction(void *builder, void *scope, const char *name,
    const char *linkage, void *file, double lineno, void *type, double isLocal,
    double isDefinition, double scopeLine) {
    return (void *)LLVMDIBuilderCreateFunction(
        (LLVMDIBuilderRef)builder, (LLVMMetadataRef)scope,
        name, strlen(name), linkage, strlen(linkage),
        (LLVMMetadataRef)file, (unsigned)lineno, (LLVMMetadataRef)type,
        (LLVMBool)(int)isLocal, (LLVMBool)(int)isDefinition,
        (unsigned)scopeLine, 0, 0);
}

void *chad2_LLVMMDStringInContext2(void *ctx, const char *str) {
    return (void *)LLVMMDStringInContext2((LLVMContextRef)ctx, str, strlen(str));
}

void *chad2_LLVMDIBuilderCreateDebugLocation(void *ctx, double line, double col, void *scope, void *inlinedAt) {
    return (void *)LLVMDIBuilderCreateDebugLocation(
        (LLVMContextRef)ctx, (unsigned)line, (unsigned)col,
        (LLVMMetadataRef)scope, (LLVMMetadataRef)inlinedAt);
}

int chad2_LLVMBuilderHasTerminator(void *builder) {
    LLVMBasicBlockRef bb = LLVMGetInsertBlock((LLVMBuilderRef)builder);
    if (!bb) return 0;
    return LLVMGetBasicBlockTerminator(bb) != NULL ? 1 : 0;
}

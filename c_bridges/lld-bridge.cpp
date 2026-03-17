#include <lld/Common/Driver.h>
#include <llvm/ADT/ArrayRef.h>
#include <llvm/Support/raw_ostream.h>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <string>

LLD_HAS_DRIVER(macho)
LLD_HAS_DRIVER(elf)

static std::vector<std::string> tokenize(const char* cmd) {
    std::vector<std::string> tokens;
    const char* p = cmd;
    while (*p) {
        while (*p == ' ' || *p == '\t') p++;
        if (!*p) break;
        std::string tok;
        while (*p && *p != ' ' && *p != '\t') {
            tok += *p++;
        }
        tokens.push_back(tok);
    }
    return tokens;
}

extern "C" {

double cs_lld_available(void) {
    return 1.0;
}

char* cs_lld_link_macho(const char* cmd_str) {
    auto tokens = tokenize(cmd_str);
    std::vector<const char*> argv;
    argv.push_back("ld64.lld");
    for (auto& t : tokens) argv.push_back(t.c_str());

    std::string err_str;
    llvm::raw_string_ostream err_stream(err_str);
    llvm::raw_null_ostream null_stream;

    lld::DriverDef drivers[] = {
        {lld::Darwin, &lld::macho::link}
    };

    lld::Result result = lld::lldMain(
        llvm::ArrayRef<const char*>(argv.data(), argv.size()),
        null_stream, err_stream,
        llvm::ArrayRef<lld::DriverDef>(drivers, 1));

    if (result.retCode != 0) {
        err_stream.flush();
        if (!err_str.empty()) return strdup(err_str.c_str());
        return strdup("lld macho linking failed");
    }
    return strdup("");
}

char* cs_lld_link_elf(const char* cmd_str) {
    auto tokens = tokenize(cmd_str);
    std::vector<const char*> argv;
    argv.push_back("ld.lld");
    for (auto& t : tokens) argv.push_back(t.c_str());

    std::string err_str;
    llvm::raw_string_ostream err_stream(err_str);
    llvm::raw_null_ostream null_stream;

    lld::DriverDef drivers[] = {
        {lld::Gnu, &lld::elf::link}
    };

    lld::Result result = lld::lldMain(
        llvm::ArrayRef<const char*>(argv.data(), argv.size()),
        null_stream, err_stream,
        llvm::ArrayRef<lld::DriverDef>(drivers, 1));

    if (result.retCode != 0) {
        err_stream.flush();
        if (!err_str.empty()) return strdup(err_str.c_str());
        return strdup("lld elf linking failed");
    }
    return strdup("");
}

}

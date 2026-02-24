#include <tree_sitter/api.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

extern TSLanguage *tree_sitter_tsx(void);
extern void *GC_malloc_uncollectable(size_t size);
extern void *GC_malloc_atomic(size_t size);

TSTree *__ts_parse_source(const char *source, uint32_t length) {
    TSParser *parser = ts_parser_new();
    TSLanguage *lang = tree_sitter_tsx();
    ts_parser_set_language(parser, lang);
    return ts_parser_parse_string(parser, NULL, source, length);
}

TSNode *__ts_get_root_node(const TSTree *tree) {
    TSNode *node = (TSNode *)GC_malloc_uncollectable(sizeof(TSNode));
    *node = ts_tree_root_node(tree);
    return node;
}

const char *__ts_node_type(const TSNode *node) {
    return ts_node_type(*node);
}

uint32_t __ts_node_child_count(const TSNode *node) {
    return ts_node_child_count(*node);
}

uint32_t __ts_node_named_child_count(const TSNode *node) {
    return ts_node_named_child_count(*node);
}

TSNode *__ts_node_child(const TSNode *node, uint32_t index) {
    TSNode *child = (TSNode *)GC_malloc_uncollectable(sizeof(TSNode));
    *child = ts_node_child(*node, index);
    return child;
}

TSNode *__ts_node_named_child(const TSNode *node, uint32_t index) {
    TSNode *child = (TSNode *)GC_malloc_uncollectable(sizeof(TSNode));
    *child = ts_node_named_child(*node, index);
    return child;
}

uint32_t __ts_node_start_byte(const TSNode *node) {
    return ts_node_start_byte(*node);
}

uint32_t __ts_node_end_byte(const TSNode *node) {
    return ts_node_end_byte(*node);
}

char *__ts_node_text(const TSNode *node, const char *source) {
    uint32_t start = ts_node_start_byte(*node);
    uint32_t end = ts_node_end_byte(*node);
    uint32_t len = end - start;
    char *buf = (char *)GC_malloc_atomic(len + 1);
    strncpy(buf, source + start, len);
    buf[len] = '\0';
    return buf;
}

bool __ts_node_is_null(const TSNode *node) {
    return ts_node_is_null(*node);
}

bool __ts_node_is_named(const TSNode *node) {
    return ts_node_is_named(*node);
}

TSNode *__ts_node_child_by_field_name(const TSNode *node, const char *field, uint32_t field_len) {
    TSNode *child = (TSNode *)GC_malloc_uncollectable(sizeof(TSNode));
    *child = ts_node_child_by_field_name(*node, field, field_len);
    return child;
}

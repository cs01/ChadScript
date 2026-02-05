export class TreeSitterGenerator {
  generateDeclarations(): string {
    let ir = '; Tree-sitter library declarations\n';
    ir += '; Incremental parsing library for source code\n\n';

    ir += '; Type definitions are prepended at IR generation start\n';
    ir += '; See llvm-generator.ts generate() for type definitions\n\n';

    ir += '; Parser lifecycle functions\n';
    ir += 'declare %TSParser* @ts_parser_new()\n';
    ir += 'declare void @ts_parser_delete(%TSParser*)\n';
    ir += 'declare void @ts_parser_reset(%TSParser*)\n\n';

    ir += '; Language functions\n';
    ir += 'declare i1 @ts_parser_set_language(%TSParser*, %TSLanguage*)\n';
    ir += 'declare %TSLanguage* @ts_parser_language(%TSParser*)\n\n';

    ir += '; TypeScript language getter (from tree-sitter-typescript)\n';
    ir += 'declare %TSLanguage* @tree_sitter_typescript()\n\n';

    ir += '; Parsing functions\n';
    ir += '; Note: ts_parser_parse_string takes TSParser*, TSTree* (old_tree, can be null),\n';
    ir += ';       const char* string, uint32_t length\n';
    ir += 'declare %TSTree* @ts_parser_parse_string(%TSParser*, %TSTree*, i8*, i32)\n\n';

    ir += '; Tree functions\n';
    ir += 'declare %TSTree* @ts_tree_copy(%TSTree*)\n';
    ir += 'declare void @ts_tree_delete(%TSTree*)\n';
    ir += 'declare %TSLanguage* @ts_tree_language(%TSTree*)\n\n';

    ir += '; ts_tree_root_node returns TSNode by value (32 bytes)\n';
    ir += '; On x86_64, large structs are returned via sret (struct return pointer)\n';
    ir += 'declare void @ts_tree_root_node(%TSNode* sret(%TSNode), %TSTree*)\n\n';

    ir += '; Node property functions\n';
    ir += '; These take TSNode by value - on x86_64 Linux, passed as 4 i64 values\n';
    ir += 'declare i8* @ts_node_type(%TSNode* byval(%TSNode))\n';
    ir += 'declare i32 @ts_node_start_byte(%TSNode* byval(%TSNode))\n';
    ir += 'declare i32 @ts_node_end_byte(%TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_start_point(%TSPoint* sret(%TSPoint), %TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_end_point(%TSPoint* sret(%TSPoint), %TSNode* byval(%TSNode))\n';
    ir += 'declare i8* @ts_node_string(%TSNode* byval(%TSNode))\n\n';

    ir += '; Node traversal functions\n';
    ir += 'declare i32 @ts_node_child_count(%TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_child(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode), i32)\n';
    ir += 'declare i32 @ts_node_named_child_count(%TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_named_child(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode), i32)\n';
    ir += 'declare void @ts_node_parent(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_next_sibling(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode))\n';
    ir += 'declare void @ts_node_prev_sibling(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode))\n\n';

    ir += '; Node predicate functions\n';
    ir += 'declare i1 @ts_node_is_null(%TSNode* byval(%TSNode))\n';
    ir += 'declare i1 @ts_node_is_named(%TSNode* byval(%TSNode))\n';
    ir += 'declare i1 @ts_node_is_missing(%TSNode* byval(%TSNode))\n';
    ir += 'declare i1 @ts_node_has_error(%TSNode* byval(%TSNode))\n';
    ir += 'declare i1 @ts_node_is_error(%TSNode* byval(%TSNode))\n\n';

    ir += '; Node field access\n';
    ir += 'declare i8* @ts_node_field_name_for_child(%TSNode* byval(%TSNode), i32)\n';
    ir += 'declare void @ts_node_child_by_field_name(%TSNode* sret(%TSNode), %TSNode* byval(%TSNode), i8*, i32)\n\n';

    return ir;
  }

  generateParseSourceHelper(): string {
    let ir = '; __ts_parse_source(source: i8*, length: i32) -> %TSTree*\n';
    ir += '; High-level helper to parse TypeScript source code\n';
    ir += 'define %TSTree* @__ts_parse_source(i8* %source, i32 %length) {\n';
    ir += 'entry:\n';
    ir += '  ; Create parser\n';
    ir += '  %parser = call %TSParser* @ts_parser_new()\n';
    ir += '\n';
    ir += '  ; Get TypeScript language\n';
    ir += '  %lang = call %TSLanguage* @tree_sitter_typescript()\n';
    ir += '\n';
    ir += '  ; Set language\n';
    ir += '  %ok = call i1 @ts_parser_set_language(%TSParser* %parser, %TSLanguage* %lang)\n';
    ir += '\n';
    ir += '  ; Parse the source (null for old_tree since this is first parse)\n';
    ir += '  %tree = call %TSTree* @ts_parser_parse_string(%TSParser* %parser, %TSTree* null, i8* %source, i32 %length)\n';
    ir += '\n';
    ir += '  ; We keep the parser alive since tree references it internally\n';
    ir += '  ; In production code, we would store parser in a global or struct\n';
    ir += '  ret %TSTree* %tree\n';
    ir += '}\n\n';
    return ir;
  }

  generateGetRootNodeHelper(): string {
    let ir = '; __ts_get_root_node(tree: %TSTree*) -> %TSNode*\n';
    ir += '; Returns pointer to heap-allocated TSNode (caller owns memory via GC)\n';
    ir += 'define %TSNode* @__ts_get_root_node(%TSTree* %tree) {\n';
    ir += 'entry:\n';
    ir += '  ; Allocate TSNode on GC heap (32 bytes)\n';
    ir += '  %node_mem = call i8* @GC_malloc_uncollectable(i64 32)\n';
    ir += '  %node = bitcast i8* %node_mem to %TSNode*\n';
    ir += '\n';
    ir += '  ; Call ts_tree_root_node with sret\n';
    ir += '  call void @ts_tree_root_node(%TSNode* sret(%TSNode) %node, %TSTree* %tree)\n';
    ir += '\n';
    ir += '  ret %TSNode* %node\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeTypeHelper(): string {
    let ir = '; __ts_node_type(node: %TSNode*) -> i8*\n';
    ir += '; Get node type as string\n';
    ir += 'define i8* @__ts_node_type(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %type = call i8* @ts_node_type(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i8* %type\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeChildCountHelper(): string {
    let ir = '; __ts_node_child_count(node: %TSNode*) -> i32\n';
    ir += '; Get number of children\n';
    ir += 'define i32 @__ts_node_child_count(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %count = call i32 @ts_node_child_count(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i32 %count\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeChildHelper(): string {
    let ir = '; __ts_node_child(node: %TSNode*, index: i32) -> %TSNode*\n';
    ir += '; Get child at index, returns GC-allocated node\n';
    ir += 'define %TSNode* @__ts_node_child(%TSNode* %node, i32 %index) {\n';
    ir += 'entry:\n';
    ir += '  ; Allocate result node on GC heap\n';
    ir += '  %child_mem = call i8* @GC_malloc_uncollectable(i64 32)\n';
    ir += '  %child = bitcast i8* %child_mem to %TSNode*\n';
    ir += '\n';
    ir += '  ; Call ts_node_child with sret and byval\n';
    ir += '  call void @ts_node_child(%TSNode* sret(%TSNode) %child, %TSNode* byval(%TSNode) %node, i32 %index)\n';
    ir += '\n';
    ir += '  ret %TSNode* %child\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeStartByteHelper(): string {
    let ir = '; __ts_node_start_byte(node: %TSNode*) -> i32\n';
    ir += 'define i32 @__ts_node_start_byte(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %start = call i32 @ts_node_start_byte(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i32 %start\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeEndByteHelper(): string {
    let ir = '; __ts_node_end_byte(node: %TSNode*) -> i32\n';
    ir += 'define i32 @__ts_node_end_byte(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %end = call i32 @ts_node_end_byte(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i32 %end\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeTextHelper(): string {
    let ir = '; __ts_node_text(node: %TSNode*, source: i8*) -> i8*\n';
    ir += '; Extract the text for a node from the source\n';
    ir += 'define i8* @__ts_node_text(%TSNode* %node, i8* %source) {\n';
    ir += 'entry:\n';
    ir += '  ; Get start and end bytes\n';
    ir += '  %start = call i32 @ts_node_start_byte(%TSNode* byval(%TSNode) %node)\n';
    ir += '  %end = call i32 @ts_node_end_byte(%TSNode* byval(%TSNode) %node)\n';
    ir += '\n';
    ir += '  ; Calculate length\n';
    ir += '  %len = sub i32 %end, %start\n';
    ir += '  %len64 = zext i32 %len to i64\n';
    ir += '\n';
    ir += '  ; Allocate buffer (len + 1 for null terminator)\n';
    ir += '  %bufsize = add i64 %len64, 1\n';
    ir += '  %buf = call i8* @GC_malloc_atomic(i64 %bufsize)\n';
    ir += '\n';
    ir += '  ; Get pointer to start of text in source\n';
    ir += '  %start64 = zext i32 %start to i64\n';
    ir += '  %src_ptr = getelementptr i8, i8* %source, i64 %start64\n';
    ir += '\n';
    ir += '  ; Copy text to buffer\n';
    ir += '  call i8* @strncpy(i8* %buf, i8* %src_ptr, i64 %len64)\n';
    ir += '\n';
    ir += '  ; Null terminate\n';
    ir += '  %term_ptr = getelementptr i8, i8* %buf, i64 %len64\n';
    ir += '  store i8 0, i8* %term_ptr\n';
    ir += '\n';
    ir += '  ret i8* %buf\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeIsNullHelper(): string {
    let ir = '; __ts_node_is_null(node: %TSNode*) -> i1\n';
    ir += 'define i1 @__ts_node_is_null(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %isnull = call i1 @ts_node_is_null(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i1 %isnull\n';
    ir += '}\n\n';
    return ir;
  }

  generateNodeIsNamedHelper(): string {
    let ir = '; __ts_node_is_named(node: %TSNode*) -> i1\n';
    ir += 'define i1 @__ts_node_is_named(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %isnamed = call i1 @ts_node_is_named(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i1 %isnamed\n';
    ir += '}\n\n';
    return ir;
  }

  generateNamedChildHelper(): string {
    let ir = '; __ts_node_named_child(node: %TSNode*, index: i32) -> %TSNode*\n';
    ir += 'define %TSNode* @__ts_node_named_child(%TSNode* %node, i32 %index) {\n';
    ir += 'entry:\n';
    ir += '  %child_mem = call i8* @GC_malloc_uncollectable(i64 32)\n';
    ir += '  %child = bitcast i8* %child_mem to %TSNode*\n';
    ir += '  call void @ts_node_named_child(%TSNode* sret(%TSNode) %child, %TSNode* byval(%TSNode) %node, i32 %index)\n';
    ir += '  ret %TSNode* %child\n';
    ir += '}\n\n';
    return ir;
  }

  generateNamedChildCountHelper(): string {
    let ir = '; __ts_node_named_child_count(node: %TSNode*) -> i32\n';
    ir += 'define i32 @__ts_node_named_child_count(%TSNode* %node) {\n';
    ir += 'entry:\n';
    ir += '  %count = call i32 @ts_node_named_child_count(%TSNode* byval(%TSNode) %node)\n';
    ir += '  ret i32 %count\n';
    ir += '}\n\n';
    return ir;
  }

  generateChildByFieldNameHelper(): string {
    let ir = '; __ts_node_child_by_field_name(node: %TSNode*, field: i8*, field_len: i32) -> %TSNode*\n';
    ir += 'define %TSNode* @__ts_node_child_by_field_name(%TSNode* %node, i8* %field, i32 %field_len) {\n';
    ir += 'entry:\n';
    ir += '  %child_mem = call i8* @GC_malloc_uncollectable(i64 32)\n';
    ir += '  %child = bitcast i8* %child_mem to %TSNode*\n';
    ir += '  call void @ts_node_child_by_field_name(%TSNode* sret(%TSNode) %child, %TSNode* byval(%TSNode) %node, i8* %field, i32 %field_len)\n';
    ir += '  ret %TSNode* %child\n';
    ir += '}\n\n';
    return ir;
  }
}

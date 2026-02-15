export class TreeSitterGenerator {
  generateDeclarations(): string {
    let ir = '; Tree-sitter bridge function declarations (implemented in c_bridges/treesitter-bridge.c)\n';
    ir += '; These C wrappers handle struct passing ABI correctly on all platforms\n\n';

    ir += 'declare %TSTree* @__ts_parse_source(i8*, i32)\n';
    ir += 'declare %TSNode* @__ts_get_root_node(%TSTree*)\n';
    ir += 'declare i8* @__ts_node_type(%TSNode*)\n';
    ir += 'declare i32 @__ts_node_child_count(%TSNode*)\n';
    ir += 'declare i32 @__ts_node_named_child_count(%TSNode*)\n';
    ir += 'declare %TSNode* @__ts_node_child(%TSNode*, i32)\n';
    ir += 'declare %TSNode* @__ts_node_named_child(%TSNode*, i32)\n';
    ir += 'declare i32 @__ts_node_start_byte(%TSNode*)\n';
    ir += 'declare i32 @__ts_node_end_byte(%TSNode*)\n';
    ir += 'declare i8* @__ts_node_text(%TSNode*, i8*)\n';
    ir += 'declare i1 @__ts_node_is_null(%TSNode*)\n';
    ir += 'declare i1 @__ts_node_is_named(%TSNode*)\n';
    ir += 'declare %TSNode* @__ts_node_child_by_field_name(%TSNode*, i8*, i32)\n';

    return ir;
  }
}

declare function __ts_parse_source(source: string, length: number): any;
declare function __ts_get_root_node(tree: any): any;
declare function __ts_node_type(node: any): string;
declare function __ts_node_child_count(node: any): number;
declare function __ts_node_named_child_count(node: any): number;
declare function __ts_node_text(node: any, source: string): string;

const source = "const x = 5;";
const tree = __ts_parse_source(source, 12);
const root = __ts_get_root_node(tree);

const nodeType = __ts_node_type(root);
console.log("Root node type: " + nodeType);

const childCount = __ts_node_child_count(root);
console.log("Child count: " + childCount);

const namedChildCount = __ts_node_named_child_count(root);
console.log("Named child count: " + namedChildCount);

const rootText = __ts_node_text(root, source);
console.log("Root text: " + rootText);

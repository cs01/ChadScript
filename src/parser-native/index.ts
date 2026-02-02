import * as fs from 'fs';

declare function __ts_parse_source(source: string, length: number): number;
declare function __ts_get_root_node(tree: number): number;
declare function __ts_node_type(node: number): string;
declare function __ts_node_child_count(node: number): number;
declare function __ts_node_child(node: number, index: number): number;
declare function __ts_node_named_child(node: number, index: number): number;
declare function __ts_node_named_child_count(node: number): number;
declare function __ts_node_start_byte(node: number): number;
declare function __ts_node_end_byte(node: number): number;
declare function __ts_node_text(node: number, source: string): string;
declare function __ts_node_is_null(node: number): boolean;
declare function __ts_node_is_named(node: number): boolean;
declare function __ts_node_child_by_field_name(node: number, field: string, fieldLen: number): number;

export interface TreeSitterNode {
  nodePtr: number;
  source: string;
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  namedChildCount: number;
  isNamed: boolean;
  isNull: boolean;
}

export interface TreeSitterTree {
  treePtr: number;
  source: string;
  rootNode: TreeSitterNode;
}

export function createNode(nodePtr: number, source: string): TreeSitterNode {
  return {
    nodePtr: nodePtr,
    source: source,
    type: __ts_node_type(nodePtr),
    text: __ts_node_text(nodePtr, source),
    startIndex: __ts_node_start_byte(nodePtr),
    endIndex: __ts_node_end_byte(nodePtr),
    childCount: __ts_node_child_count(nodePtr),
    namedChildCount: __ts_node_named_child_count(nodePtr),
    isNamed: __ts_node_is_named(nodePtr),
    isNull: __ts_node_is_null(nodePtr)
  };
}

export function getChild(node: TreeSitterNode, index: number): TreeSitterNode | null {
  if (index < 0 || index >= node.childCount) {
    return null;
  }
  const childPtr = __ts_node_child(node.nodePtr, index);
  if (__ts_node_is_null(childPtr)) {
    return null;
  }
  return createNode(childPtr, node.source);
}

export function getNamedChild(node: TreeSitterNode, index: number): TreeSitterNode | null {
  if (index < 0 || index >= node.namedChildCount) {
    return null;
  }
  const childPtr = __ts_node_named_child(node.nodePtr, index);
  if (__ts_node_is_null(childPtr)) {
    return null;
  }
  return createNode(childPtr, node.source);
}

export function getChildByFieldName(node: TreeSitterNode, fieldName: string): TreeSitterNode | null {
  const childPtr = __ts_node_child_by_field_name(node.nodePtr, fieldName, fieldName.length);
  if (__ts_node_is_null(childPtr)) {
    return null;
  }
  return createNode(childPtr, node.source);
}

export function parseSource(source: string): TreeSitterTree {
  const treePtr = __ts_parse_source(source, source.length);
  const rootNodePtr = __ts_get_root_node(treePtr);
  const rootNode = createNode(rootNodePtr, source);
  return {
    treePtr: treePtr,
    source: source,
    rootNode: rootNode
  };
}

export function parseFile(filepath: string): TreeSitterTree {
  const source = fs.readFileSync(filepath, 'utf-8');
  return parseSource(source);
}

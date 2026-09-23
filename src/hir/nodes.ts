// HIR: the compiler's own intermediate representation, produced by lower/ and consumed by
// codegen/. Crucially, this module does NOT import `typescript` — HIR is fully decoupled from
// the frontend. Every expression node carries its resolved `ValueType`; the backend reads that
// field and never re-derives a type.

import type { ObjectField, ValueType } from "./types.js";

export interface HModule {
  functions: HFunc[];
  // Top-level statements — lowered into the synthesized `main` entry function.
  topLevel: HStmt[];
  // Every runtime object layout the program allocates, indexed by `id`. Codegen emits one
  // immutable shape global per entry; every object record stores a pointer to its shape in slot 0
  // (see runtime/abi.milo CsShape), so a record describes itself whatever static type reads it.
  shapes: ShapeDescriptor[];
}

// One allocation layout. `fields` are in record order (field i lives at record slot i + 1, after
// the shape pointer) with the static type the allocation stores there; every slot holds a Value
// (codegen/value.ts), so readers never depend on that type for correctness, only for printing.
// A class's shape also carries its identity (`className`, for instanceof and printing) and its
// method table in vtable-slot order (base methods first, an override reusing its base slot).
export interface ShapeDescriptor {
  id: number;
  fields: ObjectField[];
  className?: string;
  methods: { name: string; fn: string }[];
  // A JSON.parse TEMPLATE: no record points at it. Each parsed object gets a runtime shape derived
  // from it (cs_json_object) holding the present keys in JSON text order, and shares its print and
  // JSON functions, which therefore walk the record's own shape instead of `fields`.
  jsonTemplate?: true;
}

// One object type inside a JSON.parse target: its template shape, and per declared field (in
// `type.shape.fields` order) whether the key may be absent and whether JSON `null` is a value of it.
export interface JsonObjectTarget {
  type: ValueType;
  shape: number;
  presence: { absentOk: boolean; nullable: boolean }[];
}

// An item of a spread literal, in source order. A spread's `snapshot` says its source must be
// copied when the item is evaluated, because a later item's initializer could otherwise change a
// field before it is read (JS copies the source's fields at the spread's position).
export type SpreadItem =
  | { kind: "prop"; value: HExpr }
  | { kind: "spread"; value: HExpr; snapshot: boolean };

// One combination of spread-source shapes: `sources[j]` is the shape id the j-th SPREAD item must
// have. The result has layout `shape`; its field k comes from `fields[k]`: item `item`'s value for
// a prop, or field `index` of the (snapshotted) source record for a spread.
export interface SpreadCase {
  sources: number[];
  shape: number;
  fields: { item: number; index: number | null }[];
}

// How a member access finds its field. `slot`: every layout that can reach the site stores the
// field at record field index `index` (static, one load). `ic`: the layouts disagree, so the site
// gets inline-cache state (`site` is its program-unique id) and falls back to a by-name lookup in
// the receiver's shape; a field absent from the receiver's shape reads as `undefined`.
export type FieldAccess =
  | { kind: "slot"; index: number }
  | { kind: "ic"; site: number; name: string };

// How a method call finds its function. `vtable`: every layout reaching the receiver is the static
// class or a subclass, so method-table slot `index` (base slots are shared down the hierarchy)
// holds the implementation. `byName`: anything else (an interface-typed receiver that may hold a
// class instance or a literal with a function field); the site's inline cache resolves `name` in
// the receiver's shape to a method-table entry (called with the object as `this`) or a field
// holding a closure (called with its env).
export type MethodDispatch =
  | { kind: "vtable"; index: number }
  | { kind: "byName"; site: number; name: string };

// `cell`: the binding is shared with a closure and reassigned (lower/cells.ts), so its storage is
// a GC-allocated heap cell the frame holds a pointer to, instead of a stack slot. Set on a
// parameter, a varDecl, a for-of binding or a catch binding.
export interface HParam {
  name: string;
  type: ValueType;
  cell?: true;
}

// `byRef`: the captured variable is a cell; the env slot holds the cell pointer (shared storage)
// rather than a copy of the value.
export interface HCapture {
  name: string; // the HIR name of the captured variable (from the enclosing scope)
  type: ValueType;
  byRef?: true;
}

export interface HFunc {
  name: string; // unique HIR name (symbol-resolved), used as the LLVM function name
  params: HParam[];
  returnType: ValueType | null; // null = void
  body: HStmt[];
  // A lifted lambda takes a hidden `env` pointer as its first LLVM parameter and binds these
  // captured variables from it at entry. Empty/undefined for ordinary functions.
  captures?: HCapture[];
  // An `async function`: codegen emits it as a fiber body (`cs_fiber_return` on completion) and a
  // CALL to it spawns a fiber (yielding a Promise) rather than running it synchronously.
  async?: boolean;
}

// What a for...of walks. An array by index (re-reading its length each step, as JS does). A Map or
// Set LIVE, through the runtime's ordered-table iterator (runtime/ordered.milo), so entries the
// body adds are visited and ones it deletes are skipped; `slot` picks the keys (a Set's elements)
// or the values.
export type ForOfSource =
  | { kind: "array"; array: HExpr }
  | { kind: "collection"; collection: HExpr; slot: "key" | "value" };

export type HStmt =
  // console.log of zero or more values, printed space-separated with a trailing newline.
  | { kind: "consoleLog"; values: HExpr[] }
  | { kind: "processExit"; code: HExpr }
  // A `let`/`const` binding with an initializer. `name` is unique per module (Phase 1 has a
  // single scope — the entry function). `type` is the variable's resolved type.
  | { kind: "varDecl"; name: string; init: HExpr; type: ValueType; cell?: true }
  // Reassignment to an existing `let` binding (const reassignment is blocked by the tsc gate).
  // Compound assignment (`+=` etc.) is lowered to `value = <var> <op> rhs`.
  | { kind: "assign"; name: string; value: HExpr }
  // `obj.field = value` write. `value` is boxed to a Value from its own type.
  | { kind: "memberSet"; object: HExpr; access: FieldAccess; value: HExpr }
  // `arr[i] = value` write. Out-of-range indices are a no-op, matching JS for a negative or
  // fractional index; a past-the-end write would grow a JS array, which the subset rejects
  // (there is no sparse-array representation), so the validator gates that shape.
  | { kind: "indexSet"; array: HExpr; index: HExpr; value: HExpr; elementType: ValueType }
  // `if (cond) { then } else { otherwise }`. `otherwise` is null when there is no else.
  // `cond` is evaluated for JS truthiness (see codegen toBool).
  | { kind: "if"; cond: HExpr; then: HStmt[]; otherwise: HStmt[] | null }
  // `while (cond) { body }` — cond re-evaluated (truthiness) before each iteration.
  | { kind: "while"; cond: HExpr; body: HStmt[] }
  // `for (init; cond; update) { body }`. `cond` null means an always-true loop. init/update
  // are statement lists (a decl or assignment). The update block is kept distinct from the body
  // so `continue` can target it once supported.
  // `perIteration` names the cell variables `init` declares: JS gives each iteration its own
  // binding (CreatePerIterationEnvironment), so before the first test and again before each update
  // they move to a fresh cell holding the current value, and a closure made in one iteration keeps
  // that iteration's cell. Non-cell loop variables need nothing: no closure can observe the copy.
  | {
      kind: "for";
      init: HStmt[];
      cond: HExpr | null;
      update: HStmt[];
      body: HStmt[];
      perIteration?: string[];
    }
  // `for (const name of source) { body }`. Binds `name` (type `elementType`) to each element; a
  // `cell` binding gets a fresh cell per iteration (each iteration is its own binding in JS).
  | {
      kind: "forOf";
      name: string;
      elementType: ValueType;
      source: ForOfSource;
      body: HStmt[];
      cell?: true;
    }
  // `return expr;` (value null for a bare `return;` in a void function).
  | { kind: "return"; value: HExpr | null }
  // `throw expr;` — unwinds to the innermost enclosing `try` handler (setjmp/longjmp), or
  // terminates with a non-zero exit if none. `isError` is true for `throw new Error(m)`, false for
  // a thrown string; `message` is that string (null when absent, e.g. `new Error()`).
  | { kind: "throwError"; isError: boolean; message: HExpr | null }
  // `throw e` re-raising a caught (unknown) value unchanged. `value` is the CsThrown.
  | { kind: "rethrowValue"; value: HExpr }
  // `try { tryBody } catch (catchParam) { catchBody } finally { finallyBody }`. Absent clauses are
  // null (at least one present). `catchParam` is the HIR name bound to the caught value (unknown),
  // or null for a binding-less catch / no catch.
  | {
      kind: "tryCatch";
      tryBody: HStmt[];
      catchBody: HStmt[] | null;
      catchParam: string | null;
      finallyBody: HStmt[] | null;
      catchCell?: true;
    }
  // `break;` / `continue;` — target the innermost enclosing loop (no labels yet).
  | { kind: "break" }
  | { kind: "continue" }
  // `switch (disc) { ... }`. Cases in source order; a case with `test === null` is `default`.
  // Bodies fall through to the next case unless they break/return (JS semantics). `discType` is
  // the discriminant's type (cases are matched with `===`).
  | { kind: "switch"; disc: HExpr; discType: ValueType; cases: HCase[] }
  // A call in statement position — result discarded. `returnType` null means a void function.
  | { kind: "callStmt"; name: string; args: HExpr[]; returnType: ValueType | null }
  // Virtual method call in statement position (void methods, or a value method whose result is
  // discarded). `returnType` null → the method is void.
  | {
      kind: "virtualCallStmt";
      receiver: HExpr;
      dispatch: MethodDispatch;
      args: HExpr[];
      returnType: ValueType | null;
    }
  // A call through a closure value (const/let arrow, parameter) in statement position. Its own
  // node because a void closure has no value, so it cannot be a callClosure expression.
  | { kind: "callClosureStmt"; callee: HExpr; args: HExpr[]; returnType: ValueType | null }
  // An expression evaluated for its side effects only, result discarded (e.g. `arr.push(x);`).
  | { kind: "exprStmt"; expr: HExpr };

export interface HCase {
  test: HExpr | null; // null = the `default` clause
  body: HStmt[];
}

// One entry in an array literal. `spread` true → `value` is an array whose elements are copied
// in (`...src`); false → `value` is a single element.
export interface ArrayElement {
  spread: boolean;
  value: HExpr;
}

// What a typeIs node asks. The first eight are the `typeof` results JS defines (`bigint` and
// `symbol` are never true here: neither type is representable); "array" is `Array.isArray`.
export type TypeTest =
  | "number"
  | "string"
  | "boolean"
  | "undefined"
  | "object"
  | "function"
  | "bigint"
  | "symbol"
  | "array";

export type UnaryOp = "neg" | "pos" | "not" | "bnot";
export type LogicalOp = "and" | "or";
// Arithmetic + bitwise ops produce a number; comparison ops (lt..ne) produce a boolean. The
// `type` field on the binary node records which — lower/ stamps it from the checker.
export type BinaryOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "rem"
  | "lt"
  | "gt"
  | "le"
  | "ge"
  | "eq"
  | "ne"
  // Bitwise / shift (JS int32 semantics; `ushr` is the unsigned `>>>`).
  | "band"
  | "bor"
  | "bxor"
  | "shl"
  | "shr"
  | "ushr";

export type HExpr =
  | { kind: "numberLit"; value: number; type: ValueType }
  | { kind: "stringLit"; value: string; type: ValueType }
  | { kind: "boolLit"; value: boolean; type: ValueType }
  | { kind: "varRef"; name: string; type: ValueType }
  // Call to a user function by its resolved HIR name. `type` is the return type.
  | { kind: "call"; name: string; args: HExpr[]; type: ValueType }
  // A `Math.*` builtin call (number-valued). `fn` is the method name (floor/sqrt/pow/...).
  | { kind: "mathCall"; fn: string; args: HExpr[]; type: ValueType }
  // A direct call to a runtime C entry point (e.g. cs_parse_int). `fn` is the FULL symbol name;
  // args are evaluated left-to-right and passed as-is. `type` is the return type.
  | { kind: "runtimeCall"; fn: string; args: HExpr[]; type: ValueType }
  // Create a closure: the lifted lambda `lambdaName` plus a captured-variable environment.
  // `display` is how util.inspect shows the function (`[Function: name]`, with JS's inferred name).
  | { kind: "closure"; lambdaName: string; captures: HCapture[]; display: string; type: ValueType }
  // Call a function VALUE (closure): load its fnptr + env and invoke. `type` is the return type.
  | { kind: "callClosure"; callee: HExpr; args: HExpr[]; type: ValueType }
  // Method call on an object, `receiver.m(args)`, found through the receiver's shape (see
  // MethodDispatch). Non-void value position; the statement form is virtualCallStmt.
  | {
      kind: "virtualCall";
      receiver: HExpr;
      dispatch: MethodDispatch;
      args: HExpr[];
      type: ValueType;
    }
  // Ternary `cond ? whenTrue : whenFalse`. Both arms share the result `type` (tsc's common type).
  | { kind: "conditional"; cond: HExpr; whenTrue: HExpr; whenFalse: HExpr; type: ValueType }
  // `n.toString(radix?)` → string. `radix` null means base 10 (shortest round-trip).
  | { kind: "numToString"; value: HExpr; radix: HExpr | null; type: ValueType }
  // The global conversion functions `String(x)` / `Number(x)` / `Boolean(x)`. Codegen dispatches
  // on `op` and the value's type; `type` is the result (string/number/boolean respectively).
  | { kind: "convert"; op: "String" | "Number" | "Boolean"; value: HExpr; type: ValueType }
  // `str.length` → number.
  | { kind: "strLen"; str: HExpr; type: ValueType }
  // A `string.method(args)` builtin. `method` is the JS name; result type is `type`.
  | { kind: "strMethod"; method: string; receiver: HExpr; args: HExpr[]; type: ValueType }
  // Array literal `[a, ...b, c]`. Each element is either a single value or a `...spread` of an
  // array-typed source (whose slots are copied in). `type` is the array type.
  | { kind: "arrayLit"; elements: ArrayElement[]; type: ValueType }
  // `arr.length` → number.
  | { kind: "arrayLen"; array: HExpr; type: ValueType }
  // `arr[i]` index access → `element | undefined` (bounds-checked). `type` is the optional type.
  | { kind: "index"; array: HExpr; index: HExpr; elementType: ValueType; type: ValueType }
  // `a ?? b`: if `a` is undefined, evaluate `b`; else unwrap `a`. `type` is the (non-optional)
  // result type.
  | { kind: "coalesce"; left: HExpr; right: HExpr; type: ValueType }
  // Unwrap a narrowed optional to its inner value. Emitted by lower when a var whose DECLARED
  // type is optional is used at a narrowed (non-optional) type (after `x !== undefined`).
  | { kind: "unwrap"; value: HExpr; type: ValueType }
  // `x instanceof C` → boolean. `shapes` are the shape ids of C and every subclass; codegen
  // compares the receiver's shape pointer to each.
  | { kind: "instanceofCheck"; value: HExpr; shapes: number[]; type: ValueType }
  // `e instanceof Error` for a caught (unknown) value → the CsThrown's `isError` tag.
  | { kind: "thrownIsError"; value: HExpr; type: ValueType }
  // `x === undefined` / `x !== undefined` → boolean (compares against the sentinel).
  // `x === null`/`x === undefined` (and `!==`). `sentinel` says which marker to compare against,
  // so `x === null` and `x === undefined` are distinguished for a `T | null | undefined` value.
  | {
      kind: "nullCheck";
      value: HExpr;
      isEqual: boolean;
      sentinel: "null" | "undefined";
      type: ValueType;
    }
  // The two Value conversions (codegen/value.ts). `box`: a value of a concrete type (`value.type`,
  // never `value`) flowing into a Value-union position (`type.kind === "value"`), e.g. `3` assigned
  // to a `number | string` variable. `unbox`: a Value read at a concrete type (`type`, never
  // `value`) because tsc narrowed it there (`typeof x === "number" ? x + 1 : 0`); the word is
  // trusted to hold that type, since the narrowing that produced `type` is tsc's proof. Every
  // conversion is one of these nodes, so verifyHir can check both ends of each.
  | { kind: "box"; value: HExpr; type: ValueType }
  | { kind: "unbox"; value: HExpr; type: ValueType }
  // The two container conversions at an erased-generic boundary (lower/generics.ts), where one side
  // stores T as a Value word and the other as the instantiation's machine value. `convertArray`
  // COPIES array `value` into a fresh array of `type`, converting each element through its Value
  // word; lower only emits it where the copy is unobservable (a spread, or an array the callee
  // built and dropped). `adaptClosure` wraps closure `value` in a new closure of function `type`
  // that converts each argument to `value`'s parameter representation and the result back.
  | { kind: "convertArray"; value: HExpr; type: ValueType }
  | { kind: "adaptClosure"; value: HExpr; type: ValueType }
  // `typeof x` as a string value. `value` may have any type; only a Value (or an optional) needs a
  // run-time answer.
  | { kind: "typeOf"; value: HExpr; type: ValueType }
  // A type test that narrows: `typeof x === "number"` (test = the typeof name) or
  // `Array.isArray(x)` (test "array"). Result boolean. Kept apart from typeOf + string compare so a
  // narrowing check is a tag test, not a string comparison.
  | { kind: "typeIs"; value: HExpr; test: TypeTest; type: ValueType }
  // Wrap an inner value into a present optional (a box). Used for `{ x: 5 }` where field x is
  // optional. `type` is the optional type.
  | { kind: "wrap"; value: HExpr; type: ValueType }
  // The `undefined` / `null` value of an optional type (the respective sentinel). undefinedOpt is
  // also used for an omitted optional field.
  | { kind: "undefinedOpt"; type: ValueType }
  | { kind: "nullOpt"; type: ValueType }
  // Bare `null` / `undefined` literals (type `null` / `undefined`). Only meaningful where the
  // context prints them (console.log) or coerces them into an optional; evalValue rejects them.
  | { kind: "nullLit"; type: ValueType }
  | { kind: "undefinedLit"; type: ValueType }
  // `arr.push(value)` → the new length (number). `elementType` says how to box the value.
  | { kind: "arrayPush"; array: HExpr; value: HExpr; elementType: ValueType; type: ValueType }
  // `arr.pop()` / `arr.shift()` → `element | undefined`. `fn` is the runtime entry point.
  | { kind: "arrayPop"; array: HExpr; fn: string; type: ValueType }
  // `arr.at(i)` → `element | undefined` (negative index counts from the end).
  | { kind: "arrayAt"; array: HExpr; index: HExpr; type: ValueType }
  // `str.at(i)` → `string | undefined`.
  | { kind: "strAt"; str: HExpr; index: HExpr; type: ValueType }
  // `arr.join(sep?)` → string. `separator` null means the default ",". Each element is coerced.
  | {
      kind: "arrayJoin";
      array: HExpr;
      separator: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
  // `arr.includes(x)` → boolean, `arr.indexOf(x)` → number. `wantIndex` distinguishes them.
  | {
      kind: "arraySearch";
      array: HExpr;
      value: HExpr;
      elementType: ValueType;
      wantIndex: boolean;
      type: ValueType;
    }
  // Array→array transforms that are a single runtime call (reverse/slice/concat). `fn` is the
  // runtime entry point; `args` are the extra arguments after the receiver.
  | { kind: "arrayXform"; fn: string; array: HExpr; args: HExpr[]; type: ValueType }
  // Map operations. `keyKind` (0 number / 1 string / 2 boolean) selects the runtime's key
  // equality. `mapNew` is `new Map()`; `mapGet` → `value | undefined`; `set` returns the map.
  | { kind: "mapNew"; type: ValueType }
  | { kind: "mapSet"; map: HExpr; key: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | {
      kind: "mapGet";
      map: HExpr;
      key: HExpr;
      keyKind: number;
      valueType: ValueType;
      type: ValueType;
    }
  | { kind: "mapHas"; map: HExpr; key: HExpr; keyKind: number; type: ValueType }
  | { kind: "mapDelete"; map: HExpr; key: HExpr; keyKind: number; type: ValueType }
  | { kind: "mapSize"; map: HExpr; type: ValueType }
  // Set operations. `keyKind` selects the runtime's element equality. `setNew` is `new Set()`;
  // `setFromArray` is `new Set(arr)`; `add` returns the set.
  | { kind: "setNew"; type: ValueType }
  | { kind: "setFromArray"; array: HExpr; keyKind: number; type: ValueType }
  | { kind: "setAdd"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setHas"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setDelete"; set: HExpr; value: HExpr; keyKind: number; type: ValueType }
  | { kind: "setSize"; set: HExpr; type: ValueType }
  // Materialize a Map/Set collection to a fresh array (in insertion order), so `for-of` and the
  // array methods work over it. `fn` is the runtime entry (cs_map_keys / cs_map_values /
  // cs_set_values); `receiver` is the map/set; `type` is the resulting array type.
  | { kind: "collectionToArray"; fn: string; receiver: HExpr; type: ValueType }
  // `m.forEach(cb)` / `s.forEach(cb)`: a live walk (as for...of) calling cb(value, key, collection)
  // (a Set passes its element as both value and key) with as many arguments as cb declares.
  // `type` is undefined.
  | { kind: "collectionForEach"; collection: HExpr; callback: HExpr; type: ValueType }
  // `arr.sort(cmp?)` — in-place insertion sort, returns the same array. `comparator` null means
  // JS default order (compare by String(element), lexicographic). `type` is the array type.
  | {
      kind: "arraySort";
      array: HExpr;
      comparator: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
  // Higher-order array methods that invoke a closure per element (map/filter/forEach/reduce).
  // Lowered to an inline IR loop that calls the callback closure; `init` is reduce's seed
  // (null → seed from the first element). `callback.type` is the closure's function type.
  | {
      kind: "arrayHof";
      op:
        | "map"
        | "filter"
        | "forEach"
        | "reduce"
        | "find"
        | "findIndex"
        | "some"
        | "every"
        | "flatMap";
      array: HExpr;
      callback: HExpr;
      init: HExpr | null;
      elementType: ValueType;
      type: ValueType;
    }
  // Object literal `{ f: v, ... }` allocating layout `shape`. `fields` are in the shape's record
  // order, each boxed to a Value from its own type.
  | { kind: "objectLit"; shape: number; fields: HExpr[]; type: ValueType }
  // Object literal with `...spread` items. The result layout depends on each spread source's
  // RUNTIME shape (a subtype value copies its extra fields too), so `cases` enumerates every
  // combination of source shapes the program can produce; codegen evaluates `items` left to right,
  // then dispatches on the sources' shape pointers. See SpreadCase.
  | { kind: "objectSpread"; items: SpreadItem[]; cases: SpreadCase[]; type: ValueType }
  // `Object.values(o)`: the fields of o's runtime shape in record order, each unboxed to
  // `elementType` (lower checked every reaching layout's fields share that representation).
  | { kind: "objectValues"; object: HExpr; elementType: ValueType; type: ValueType }
  // `obj?.field` where `object` is an optional object: undefined when the object is nullish, else
  // the field's Value unboxed to `type` (optional: an absent or undefined field is undefined too).
  | { kind: "optionalMember"; object: HExpr; access: FieldAccess; type: ValueType }
  // `obj.field` read, unboxed from the stored Value to `type` (the static type the site reads at).
  | { kind: "memberGet"; object: HExpr; access: FieldAccess; type: ValueType }
  // `new C(args)`: allocate a record of layout `shape` (C's), run `ctorClass.constructor(record,
  // args)`, yield the record. `ctorClass` is the nearest ancestor that declares a constructor
  // (constructors are not virtual), or null when no class in the chain declares one.
  | {
      kind: "new";
      shape: number;
      ctorClass: string | null;
      args: HExpr[];
      type: ValueType;
    }
  // `await promiseExpr`: suspend the current fiber until the promise settles, then yield its inner
  // value (or throw its rejection). `value` is promise-typed; `type` is the awaited inner type.
  | { kind: "await"; value: HExpr; type: ValueType }
  // A call to an `async function`: spawns a fiber (cs_fiber_spawn) rather than running the callee
  // synchronously; `type` is the resulting `Promise<T>`. Args are packed into the fiber's env.
  | { kind: "asyncCall"; name: string; args: HExpr[]; type: ValueType }
  // `Promise.resolve(v)`: wrap an already-available value in a fulfilled promise. `value` is the
  // inner value; `type` is the resulting `Promise<T>`.
  | { kind: "promiseResolve"; value: HExpr; type: ValueType }
  // `Promise.all(arr)`: `arr` is an array of promises; result is `Promise<T[]>` resolving to the
  // fulfilled values in order (or rejecting on the first rejection).
  | { kind: "promiseAll"; array: HExpr; type: ValueType }
  // `JSON.stringify(v)`: the JSON text of v (a recursive, type-directed walk). Result is a string.
  // `indent` is the pretty-print unit (repeated per nesting level); null = compact single-line.
  | { kind: "jsonStringify"; value: HExpr; indent: string | null; type: ValueType }
  // `JSON.parse` at a site with an explicit target annotation. `type` IS the target shape, so no
  // `any` ever enters the type domain: codegen walks the parsed tree against it and throws on any
  // disagreement, which is what makes the result trustworthy without a checker at runtime.
  // `objectShapes` gives the layout each object type inside the target is allocated with.
  | {
      kind: "jsonParse";
      text: HExpr;
      objectShapes: JsonObjectTarget[];
      // The template with no declared fields that objects under undeclared keys are laid out with.
      dynamicShape: number;
      type: ValueType;
    }
  // `Number.isInteger/isFinite/isNaN(x)` — no argument coercion (x is already number). Result bool.
  | { kind: "numberPredicate"; fn: "isInteger" | "isFinite" | "isNaN"; arg: HExpr; type: ValueType }
  | { kind: "unary"; op: UnaryOp; operand: HExpr; type: ValueType }
  // `x++` / `--x` in value position on a number variable (`() => n++` in a closure): stores
  // x + delta and yields the new value (`prefix`) or the old one. Statement position lowers to an
  // ordinary assign.
  | { kind: "update"; name: string; delta: 1 | -1; prefix: boolean; type: ValueType }
  | { kind: "binary"; op: BinaryOp; left: HExpr; right: HExpr; type: ValueType }
  // Short-circuiting `&&` / `||`. JS VALUE semantics: the result IS one of the operands (not a
  // coerced boolean), so `type` is the operands' shared type. right is evaluated only when the
  // left operand doesn't decide the result.
  | { kind: "logical"; op: LogicalOp; left: HExpr; right: HExpr; type: ValueType }
  // A template literal. `quasis` are the literal text chunks; `exprs` the interpolations. Always
  // `quasis.length === exprs.length + 1`. Interpolated values are coerced to string. Result is
  // a string.
  | { kind: "template"; quasis: string[]; exprs: HExpr[]; type: ValueType };

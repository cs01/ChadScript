// Method-call lowering: `obj.method(args)` dispatched on the receiver's ValueType (arrays, Map/Set,
// strings, Math namespace, Object namespace, class instances via vtable). The largest single lowering
// unit; split out of lower.ts, which it imports its helpers back from (circular, resolved at call time).

import { adaptCallback } from "./callback-adapt.js";
import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import {
  type LowerCtx,
  callReturnType,
  coerceToTarget,
  lowerExpr,
  lowerCallArgs,
  resolveType,
  superMethodClassOf,
  unparen,
} from "./lower.js";
import { methodDispatchAt } from "./member-access.js";
import { optionalRead } from "./value-lower.js";
import { isMathNamespace, keyKindOf } from "./declarations.js";
import { valueTypeOf, valueTypeOfTsType } from "./type-translation.js";
import { lowerCallValue } from "./generic-calls.js";
import { thisRef } from "./statements.js";
import { lowerObjectNamespace } from "./object-literal.js";
import { jsonFieldPresence } from "./layouts.js";

// The pretty-print indent unit for a JSON.stringify `space` argument: a literal number N → N spaces
// (JSON caps at 10), a literal string → up to its first 10 chars, anything falsy/absent → null
// (compact). A non-literal space argument is rejected (the indent must be known at compile time).
function jsonIndentUnit(arg: ts.Expression | undefined): string | null {
  if (!arg) return null;
  const space = unparen(arg);
  if (ts.isNumericLiteral(space)) {
    const n = Math.min(10, Math.floor(Number(space.text)));
    return n > 0 ? " ".repeat(n) : null;
  }
  if (ts.isStringLiteral(space)) return space.text.length > 0 ? space.text.slice(0, 10) : null;
  if (space.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(space) && space.text === "undefined") return null;
  return ice("lower: JSON.stringify space (3rd arg) must be a literal number or string");
}

// A method call `obj.method(args)`. Dispatched on the receiver's type + method name.
export function lowerMethodCall(call: ts.CallExpression, ctx: LowerCtx): HExpr {
  const pa = call.expression as ts.PropertyAccessExpression;
  // `Math.floor(x)` etc. — a builtin namespace call, not a value method. Check before resolving
  // the receiver's type (Math is not a value).
  if (isMathNamespace(pa.expression)) {
    return {
      kind: "mathCall",
      fn: pa.name.text,
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: VT.number,
    };
  }
  // `Date.now()` → epoch milliseconds. The validator admits only `now`.
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Date") {
    return { kind: "runtimeCall", fn: "cs_date_now", args: [], type: VT.number };
  }
  // `Object.keys(o)` / `Object.values(o)` on a closed object shape.
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Object") {
    return lowerObjectNamespace(pa.name.text, call.arguments[0]!, ctx);
  }
  // `Array.isArray(x)`: a tag test on a Value union, a constant on any other type (validate
  // allowlists only `isArray` on Array).
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Array") {
    return {
      kind: "typeIs",
      value: lowerExpr(call.arguments[0]!, ctx),
      test: "array",
      type: VT.boolean,
    };
  }
  // `Number.isInteger/isFinite/isNaN(x)` → a boolean predicate (validate allowlists the names).
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Number") {
    const fn = pa.name.text;
    if (fn === "isInteger" || fn === "isFinite" || fn === "isNaN") {
      return {
        kind: "numberPredicate",
        fn,
        arg: lowerExpr(call.arguments[0]!, ctx),
        type: VT.boolean,
      };
    }
    ice(`lower: unsupported Number.${fn}`);
  }
  // `JSON.stringify(v)` / `JSON.stringify(v, null, space)` → recursive JSON text (validate allowlists
  // only `stringify`). The optional 3rd arg (indent) must be a LITERAL number (spaces, capped 10) or
  // string (capped 10 chars) so the per-level indent is known at compile time. The 2nd arg (replacer)
  // must be null/undefined — a function/array replacer is out of the subset.
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "JSON") {
    // `JSON.parse` is admitted only where an explicit annotation supplies the target type (the
    // validator enforces that), so the target SHAPE is available here and `any` never enters HIR.
    if (pa.name.text === "parse") {
      const target = jsonParseTarget(call, ctx);
      // Each object type in the target gets a template; the record's real shape (key order, which
      // optional keys exist) is made at run time from the JSON text. No layoutShapes entry: a spread
      // that could read one of these is rejected (CS1236), so nothing enumerates its shapes.
      const objectShapes = ctx.layouts.jsonParseLayouts(call).map((l) => {
        const type = valueTypeOfTsType(l.type, call, ctx.checker);
        if (type.kind !== "object") return ice("lower: JSON.parse layout is not an object type");
        const presence = type.shape.fields.map((f) => {
          const prop =
            ctx.checker.getPropertyOfType(l.type, f.name) ??
            ice(`lower: JSON.parse field ${f.name} has no property`);
          return jsonFieldPresence(prop, call, ctx.checker);
        });
        return { type, shape: ctx.shapes.jsonTemplate(type.shape.fields), presence };
      });
      return {
        kind: "jsonParse",
        text: lowerExpr(call.arguments[0]!, ctx),
        objectShapes,
        dynamicShape: ctx.shapes.jsonTemplate([]),
        type: target,
      };
    }
    if (pa.name.text !== "stringify") ice(`lower: unsupported JSON.${pa.name.text}`);
    const replacer = call.arguments[1] && unparen(call.arguments[1]);
    if (
      replacer &&
      replacer.kind !== ts.SyntaxKind.NullKeyword &&
      !(ts.isIdentifier(replacer) && replacer.text === "undefined")
    ) {
      ice("lower: JSON.stringify replacer (2nd arg) is not supported; pass null");
    }
    return {
      kind: "jsonStringify",
      value: lowerExpr(call.arguments[0]!, ctx),
      indent: jsonIndentUnit(call.arguments[2]),
      type: VT.string,
    };
  }
  // Promise statics (validate allowlists which names reach here).
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Promise") {
    if (pa.name.text === "resolve") {
      return {
        kind: "promiseResolve",
        value: lowerExpr(call.arguments[0]!, ctx),
        type: resolveType(call, ctx),
      };
    }
    if (pa.name.text === "all") {
      // tsc types the argument as a TUPLE and the result as Promise<tuple> (both object-shaped in our
      // system). Our subset is homogeneous, so re-derive array<promise<T>> / promise<array<T>> from
      // the element promise type rather than trusting resolveType.
      const arr = lowerExpr(call.arguments[0]!, ctx);
      let arrTyped = arr;
      let elemPromise: ValueType;
      if (arr.type.kind === "array") {
        elemPromise = arr.type.element;
      } else if (arr.kind === "arrayLit" && arr.elements.length > 0) {
        elemPromise = arr.elements[0]!.value.type;
        arrTyped = { ...arr, type: VT.array(elemPromise) };
      } else {
        return ice("lower: Promise.all expects a non-empty array of promises");
      }
      const t =
        elemPromise.kind === "promise"
          ? elemPromise.inner
          : ice("lower: Promise.all element not a promise");
      return { kind: "promiseAll", array: arrTyped, type: VT.promise(VT.array(t)) };
    }
    ice(`lower: unsupported Promise.${pa.name.text}`);
  }
  // `process.argv.slice(2)` — the ONLY admitted form of process.argv (the validator rejects every
  // other use). It is a direct runtime entry, not an array method call, because `process.argv`
  // itself is not a value the backend can produce: Node's first two entries (node binary, script
  // path) have no counterpart in a compiled binary.
  if (
    ts.isPropertyAccessExpression(pa.expression) &&
    ts.isIdentifier(pa.expression.expression) &&
    pa.expression.expression.text === "process" &&
    pa.expression.name.text === "argv"
  ) {
    if (pa.name.text !== "slice") ice(`lower: process.argv.${pa.name.text} is not supported`);
    return { kind: "runtimeCall", fn: "cs_argv_slice2", args: [], type: VT.array(VT.string) };
  }

  // `super.m(args)` in value position → non-virtual base call with `this` as the receiver.
  if (pa.expression.kind === ts.SyntaxKind.SuperKeyword) {
    if (!ctx.currentBaseClass) return ice("lower: `super` with no base class");
    const rt = callReturnType(call, ctx);
    if (rt === null) ice(`lower: void method super.${pa.name.text} used as a value`);
    return {
      kind: "call",
      name: `${superMethodClassOf(ctx.currentBaseClass, pa.name.text, ctx)}.${pa.name.text}`,
      args: [thisRef(ctx), ...lowerCallArgs(call, ctx)],
      type: rt,
    };
  }
  // Lower the receiver ONCE and use its lowered type — a chained receiver like
  // `Object.values(o)` has a divergent tsc type (any[]) but a correct lowered type (number[]).
  const receiver = lowerExpr(pa.expression, ctx);
  const recvType = receiver.type;
  const method = pa.name.text;
  if (recvType.kind === "array") {
    if (method === "push") {
      return {
        kind: "arrayPush",
        array: receiver,
        values: call.arguments.map((a) => coerceToTarget(lowerExpr(a, ctx), recvType.element)),
        elementType: recvType.element,
        type: VT.number,
      };
    }
    if (method === "pop" || method === "shift") {
      const node: HExpr = {
        kind: "arrayPop",
        array: receiver,
        fn: method === "pop" ? "cs_array_pop" : "cs_array_shift",
        type: resolveType(call, ctx), // element | undefined
      };
      return optionalRead(node, recvType.element, node.type);
    }
    if (method === "join") {
      const sep = call.arguments[0];
      return {
        kind: "arrayJoin",
        array: receiver,
        separator: sep ? lowerExpr(sep, ctx) : null,
        elementType: recvType.element,
        type: VT.string,
      };
    }
    if (method === "at") {
      const node: HExpr = {
        kind: "arrayAt",
        array: receiver,
        index: lowerExpr(call.arguments[0]!, ctx),
        type: resolveType(call, ctx), // element | undefined
      };
      return optionalRead(node, recvType.element, node.type);
    }
    if (method === "flat") {
      if (call.arguments.length > 0) ice("lower: .flat(depth) not supported yet (depth 1 only)");
      return {
        kind: "arrayXform",
        fn: "cs_array_flat",
        array: receiver,
        args: [],
        type: resolveType(call, ctx),
      };
    }
    if (method === "includes" || method === "indexOf") {
      return {
        kind: "arraySearch",
        array: receiver,
        value: coerceToTarget(lowerExpr(call.arguments[0]!, ctx), recvType.element),
        elementType: recvType.element,
        wantIndex: method === "indexOf",
        type: method === "indexOf" ? VT.number : VT.boolean,
      };
    }
    const HOF_METHODS = [
      "map",
      "filter",
      "forEach",
      "reduce",
      "find",
      "findIndex",
      "some",
      "every",
      "flatMap",
    ];
    if (HOF_METHODS.includes(method)) {
      // reduce(fn, init?) — the optional seed is the 2nd argument.
      const init = method === "reduce" && call.arguments.length >= 2 ? call.arguments[1]! : null;
      const hofType = method === "forEach" ? VT.undefined : resolveType(call, ctx);
      // The arguments the loop passes (codegen/array.ts): reduce leads with the accumulator.
      const passed: ValueType[] = [recvType.element, VT.number, recvType];
      if (method === "reduce") passed.unshift(hofType);
      const node: HExpr = {
        kind: "arrayHof",
        op: method as
          | "map"
          | "filter"
          | "forEach"
          | "reduce"
          | "find"
          | "findIndex"
          | "some"
          | "every"
          | "flatMap",
        array: receiver,
        callback: adaptCallback(lowerExpr(call.arguments[0]!, ctx), passed),
        init: init ? lowerExpr(init, ctx) : null,
        elementType: recvType.element,
        // map/filter → array; forEach → undefined; find → element|undefined; findIndex → number;
        // some/every → boolean; reduce → its result. resolveType(call) covers all value cases.
        type: hofType,
      };
      return method === "find" ? optionalRead(node, recvType.element, node.type) : node;
    }
    if (method === "sort") {
      const cmp = call.arguments[0];
      return {
        kind: "arraySort",
        array: receiver,
        comparator: cmp
          ? adaptCallback(lowerExpr(cmp, ctx), [recvType.element, recvType.element])
          : null,
        elementType: recvType.element,
        type: resolveType(call, ctx),
      };
    }
    if (method === "reverse" || method === "slice" || method === "concat") {
      const fn =
        method === "slice"
          ? call.arguments.length >= 2
            ? "cs_array_slice2"
            : "cs_array_slice1"
          : `cs_array_${method}`;
      return {
        kind: "arrayXform",
        fn,
        array: receiver,
        args: call.arguments.map((a) => lowerExpr(a, ctx)),
        type: resolveType(call, ctx), // same array type
      };
    }
    return ice(`lower: unsupported array method .${method}`);
  }
  if (recvType.kind === "map") {
    const keyKind = keyKindOf(recvType.key);
    const map = receiver;
    if (method === "set") {
      return {
        kind: "mapSet",
        map,
        key: lowerExpr(call.arguments[0]!, ctx),
        value: coerceToTarget(lowerExpr(call.arguments[1]!, ctx), recvType.value),
        keyKind,
        type: recvType, // set returns the map (chainable)
      };
    }
    if (method === "get") {
      const node: HExpr = {
        kind: "mapGet",
        map,
        key: lowerExpr(call.arguments[0]!, ctx),
        keyKind,
        valueType: recvType.value,
        type: resolveType(call, ctx), // value | undefined
      };
      return optionalRead(node, recvType.value, node.type);
    }
    if (method === "has") {
      return {
        kind: "mapHas",
        map,
        key: lowerExpr(call.arguments[0]!, ctx),
        keyKind,
        type: VT.boolean,
      };
    }
    if (method === "delete") {
      return {
        kind: "mapDelete",
        map,
        key: lowerExpr(call.arguments[0]!, ctx),
        keyKind,
        type: VT.boolean,
      };
    }
    if (method === "keys") {
      return {
        kind: "collectionToArray",
        fn: "cs_map_keys",
        receiver: map,
        type: VT.array(recvType.key),
      };
    }
    if (method === "values") {
      return {
        kind: "collectionToArray",
        fn: "cs_map_values",
        receiver: map,
        type: VT.array(recvType.value),
      };
    }
    if (method === "clear" || method === "forEach")
      return lowerCollectionVoid(method, map, call, ctx);
    return ice(`lower: unsupported map method .${method}`);
  }
  if (recvType.kind === "set") {
    const keyKind = keyKindOf(recvType.element);
    const set = receiver;
    const arg0 = () => lowerExpr(call.arguments[0]!, ctx);
    if (method === "add") {
      return { kind: "setAdd", set, value: arg0(), keyKind, type: recvType }; // returns the set
    }
    if (method === "has") {
      return { kind: "setHas", set, value: arg0(), keyKind, type: VT.boolean };
    }
    if (method === "delete") {
      return { kind: "setDelete", set, value: arg0(), keyKind, type: VT.boolean };
    }
    if (method === "values" || method === "keys") {
      // Set keys() === values() in JS.
      return {
        kind: "collectionToArray",
        fn: "cs_set_values",
        receiver: set,
        type: VT.array(recvType.element),
      };
    }
    if (method === "clear" || method === "forEach")
      return lowerCollectionVoid(method, set, call, ctx);
    return ice(`lower: unsupported set method .${method}`);
  }
  if (recvType.kind === "number") {
    if (method === "toString") {
      const radix = call.arguments[0];
      return {
        kind: "numToString",
        value: receiver,
        radix: radix ? lowerExpr(radix, ctx) : null,
        type: VT.string,
      };
    }
    return ice(`lower: unsupported number method .${method}`);
  }
  if (recvType.kind === "string") {
    if (method === "at") {
      return {
        kind: "strAt",
        str: receiver,
        index: lowerExpr(call.arguments[0]!, ctx),
        type: resolveType(call, ctx), // string | undefined
      };
    }
    return {
      kind: "strMethod",
      method,
      receiver: receiver,
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: callReturnType(call, ctx) ?? VT.string,
    };
  }
  // A method (or function-valued field) of an object, found through its shape (value position).
  if (recvType.kind === "object") {
    const rt = callReturnType(call, ctx);
    if (rt === null) ice(`lower: void method .${method} used as a value`);
    const dispatch = methodDispatchAt(pa.expression, recvType, method, ctx);
    return lowerCallValue(call, valueTypeOf(call, ctx), ctx, (type) => ({
      kind: "virtualCall",
      receiver,
      dispatch,
      args: lowerCallArgs(call, ctx),
      type,
    }));
  }
  return ice(`lower: unsupported method .${method} on ${recvType.kind}`);
}

// The class whose constructor runs for `new className(...)`: the nearest class in the chain
// (self → base) that DECLARES a constructor. Constructors are called statically by `new` (not
// virtual), and a subclass without one inherits its base's. null when none in the chain declares.

// The declared type at a `JSON.parse` site. The validator has already established that the call
// sits in a variable declaration carrying an explicit type annotation, so this reads that
// annotation rather than the call's own (`any`) type.
function jsonParseTarget(call: ts.CallExpression, ctx: LowerCtx): ValueType {
  const parent = call.parent;
  if (!ts.isVariableDeclaration(parent) || !parent.type) {
    return ice("lower: JSON.parse without an explicit target annotation (validator should reject)");
  }
  return valueTypeOfTsType(ctx.checker.getTypeFromTypeNode(parent.type), parent.type, ctx.checker);
}

// `m.clear()` / `s.clear()`, and `forEach(cb)`, which walks the table live like for...of. The
// validator (form-rules: collectionCallbackMismatch) admits only a callback whose parameters have
// the representation forEach passes, so the closure is called as-is.
function lowerCollectionVoid(
  method: "clear" | "forEach",
  collection: HExpr,
  call: ts.CallExpression,
  ctx: LowerCtx,
): HExpr {
  const isMap = collection.type.kind === "map";
  if (method === "clear") {
    return {
      kind: "runtimeCall",
      fn: isMap ? "cs_map_clear" : "cs_set_clear",
      args: [collection],
      type: VT.undefined,
    };
  }
  const t = collection.type;
  const passed: ValueType[] =
    t.kind === "map"
      ? [t.value, t.key, t]
      : t.kind === "set"
        ? [t.element, t.element, t]
        : ice(`lower: forEach over ${t.kind}`);
  return {
    kind: "collectionForEach",
    collection,
    callback: adaptCallback(lowerExpr(call.arguments[0]!, ctx), passed),
    type: VT.undefined,
  };
}

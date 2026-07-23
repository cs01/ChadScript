// Method-call lowering: `obj.method(args)` dispatched on the receiver's ValueType (arrays, Map/Set,
// strings, Math namespace, Object namespace, class instances via vtable). The largest single lowering
// unit; split out of lower.ts, which it imports its helpers back from (circular, resolved at call time).

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
  lowerObjectNamespace,
  resolveType,
  vtableIndexOf,
} from "./lower.js";
import { isMathNamespace, keyKindOf } from "./declarations.js";
import { thisRef } from "./statements.js";

// The pretty-print indent unit for a JSON.stringify `space` argument: a literal number N → N spaces
// (JSON caps at 10), a literal string → up to its first 10 chars, anything falsy/absent → null
// (compact). A non-literal space argument is rejected (the indent must be known at compile time).
function jsonIndentUnit(space: ts.Expression | undefined): string | null {
  if (!space) return null;
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
  // `Object.keys(o)` / `Object.values(o)` on a closed object shape.
  if (ts.isIdentifier(pa.expression) && pa.expression.text === "Object") {
    return lowerObjectNamespace(pa.name.text, call.arguments[0]!, ctx);
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
    if (pa.name.text !== "stringify") ice(`lower: unsupported JSON.${pa.name.text}`);
    const replacer = call.arguments[1];
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
  // `super.m(args)` in value position → non-virtual base call with `this` as the receiver.
  if (pa.expression.kind === ts.SyntaxKind.SuperKeyword) {
    if (!ctx.currentBaseClass) return ice("lower: `super` with no base class");
    const rt = callReturnType(call, ctx);
    if (rt === null) ice(`lower: void method super.${pa.name.text} used as a value`);
    return {
      kind: "call",
      name: `${ctx.currentBaseClass}.${pa.name.text}`,
      args: [thisRef(ctx), ...call.arguments.map((a) => lowerExpr(a, ctx))],
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
        value: lowerExpr(call.arguments[0]!, ctx),
        elementType: recvType.element,
        type: VT.number,
      };
    }
    if (method === "pop" || method === "shift") {
      return {
        kind: "arrayPop",
        array: receiver,
        fn: method === "pop" ? "cs_array_pop" : "cs_array_shift",
        type: resolveType(call, ctx), // element | undefined
      };
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
      return {
        kind: "arrayAt",
        array: receiver,
        index: lowerExpr(call.arguments[0]!, ctx),
        type: resolveType(call, ctx), // element | undefined
      };
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
        value: lowerExpr(call.arguments[0]!, ctx),
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
      return {
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
        callback: lowerExpr(call.arguments[0]!, ctx),
        init: init ? lowerExpr(init, ctx) : null,
        elementType: recvType.element,
        // map/filter → array; forEach → undefined; find → element|undefined; findIndex → number;
        // some/every → boolean; reduce → its result. resolveType(call) covers all value cases.
        type: method === "forEach" ? VT.undefined : resolveType(call, ctx),
      };
    }
    if (method === "sort") {
      const cmp = call.arguments[0];
      return {
        kind: "arraySort",
        array: receiver,
        comparator: cmp ? lowerExpr(cmp, ctx) : null,
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
      return {
        kind: "mapGet",
        map,
        key: lowerExpr(call.arguments[0]!, ctx),
        keyKind,
        valueType: recvType.value,
        type: resolveType(call, ctx), // value | undefined
      };
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
  // Class method: `obj.m(args)` → VIRTUAL dispatch through the receiver's vtable (value position).
  if (recvType.kind === "object" && recvType.className !== undefined) {
    const rt = callReturnType(call, ctx);
    if (rt === null) ice(`lower: void method .${method} used as a value`);
    return {
      kind: "virtualCall",
      receiver,
      vtableIndex: vtableIndexOf(recvType.className, method, ctx),
      args: call.arguments.map((a) => lowerExpr(a, ctx)),
      type: rt,
    };
  }
  return ice(`lower: unsupported method .${method} on ${recvType.kind}`);
}

// The class whose constructor runs for `new className(...)`: the nearest class in the chain
// (self → base) that DECLARES a constructor. Constructors are called statically by `new` (not
// virtual), and a subclass without one inherits its base's. null when none in the chain declares.

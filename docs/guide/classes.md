# Classes and interfaces

Classes support fields with initializers, constructors, methods, single inheritance with
`extends`, `super(...)` and `super.method()`, `override`, and `instanceof`. Interfaces are
structural, as in TypeScript: a class instance and a plain object literal can both satisfy the
same interface, and a call through the interface dispatches to whichever one it holds.

<<< @/examples/classes.ts

<<< @/examples/classes.out{text}

## How it compiles

Every object, class instance or literal, starts with a pointer to an immutable runtime _shape_
that maps field names to slots and method names to functions. Because the program is compiled
whole, the compiler knows every shape that can reach a given static type. When they all agree on
where a field lives, `p.x` is a single load; when they do not (the interface above, which is
satisfied by two classes and a literal), the site gets an inline cache keyed on the shape. See
[How it works](/internals/value-model).

## Limits today

- Methods written inside an object literal (`greet() { ... }`) are rejected with
  [CS1000](/reference/errors#cs1000); use an arrow-function field as above, or a class.
- Getters and setters, `abstract`, access modifiers such as `private` and `readonly`, and
  `static` members are not supported yet ([CS1000](/reference/errors#cs1000)).
- Objects cannot gain properties after creation
  ([CS1235](/reference/errors#cs1235)). Declare every field up front, optional if needed.

Next: [Unions and narrowing](/guide/unions).

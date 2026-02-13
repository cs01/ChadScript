# Classes & Interfaces

ChadScript supports classes and interfaces with TypeScript syntax, compiled to LLVM struct types and static dispatch.

## Classes

### Declaring a Class

```typescript
class Counter {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  increment(): number {
    this.value = this.value + 1;
    return this.value;
  }

  getValue(): number {
    return this.value;
  }
}

const c = new Counter(10);
c.increment();
console.log(c.getValue()); // 12
```

Classes compile to LLVM struct types. A class like `Counter` becomes:

```llvm
%Counter_struct = type { double }
```

Methods become standalone LLVM functions with the instance passed as the first argument:

```llvm
define double @Counter_getValue(%Counter_struct* %this) {
  ...
}
```

### Constructors

Constructors are called when you use `new`. The compiler allocates the struct on the GC heap via `GC_malloc` and calls the constructor function.

```typescript
class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const p = new Point(3, 4);
```

### Parameter Properties

TypeScript's shorthand for declaring and assigning fields in the constructor is supported:

```typescript
class User {
  constructor(private name: string, private age: number) {}

  greet(): string {
    return "Hello, " + this.name;
  }
}
```

The `private`, `public`, `protected`, and `readonly` modifiers on constructor parameters automatically create class fields and assign the parameter values. Note that access modifiers are parsed but not enforced at runtime — all fields are accessible.

### Inheritance

Single inheritance via `extends` is supported. Child classes include all parent fields in their struct layout, with parent fields placed first for memory layout compatibility.

```typescript
class Animal {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  speak(): string {
    return this.name + " makes a sound";
  }
}

class Dog extends Animal {
  breed: string;

  constructor(name: string, breed: string) {
    this.name = name;
    this.breed = breed;
  }

  speak(): string {
    return this.name + " barks";
  }
}
```

Method dispatch is **static** — the compiler resolves which method to call at compile time based on the declared type. There are no vtable pointers.

### What's Supported

| Feature | Status |
|---------|--------|
| Properties (typed fields) | Supported |
| Constructors | Supported |
| Parameter properties | Supported |
| Instance methods | Supported |
| `extends` (single inheritance) | Supported |
| `implements` | Supported |
| Getters / setters | Supported |
| Static methods | Not yet supported |
| Abstract classes | Not yet supported |
| Decorators | Not supported |

## Interfaces

Interfaces compile to LLVM struct types with fields laid out in declaration order.

### Declaring an Interface

```typescript
interface Person {
  name: string;
  age: number;
  city: string;
}

function greet(p: Person): string {
  return "Hello, " + p.name + " from " + p.city;
}

const alice: Person = { name: "Alice", age: 30, city: "NYC" };
console.log(greet(alice));
```

The `Person` interface compiles to:

```llvm
%Person = type { i8*, double, i8* }
```

### Field Ordering

Object literals assigned to an interface-typed variable are automatically reordered to match the interface's declared field order. This means the following is valid — the compiler handles the reordering:

```typescript
const p: Person = { age: 30, city: "NYC", name: "Alice" };
```

### Interface Inheritance

Interfaces can extend other interfaces. Parent fields are prepended:

```typescript
interface Named {
  name: string;
}

interface Person extends Named {
  age: number;
}
```

### Implementing Interfaces

Classes can implement interfaces with the `implements` keyword:

```typescript
interface Printable {
  toString(): string;
}

class User implements Printable {
  constructor(private name: string) {}

  toString(): string {
    return this.name;
  }
}
```

## How It Differs from TypeScript

- **No runtime type checks** — `instanceof` is not available
- **No structural subtyping at runtime** — interface compatibility is checked at compile time
- **Static dispatch only** — method calls are resolved at compile time, not through vtables
- **No interface methods on object literals** — interfaces define data layout only; methods must be on classes
- **Access modifiers are not enforced** — `private`/`protected` are parsed but all fields are accessible at runtime

# Classes & Interfaces

ChadScript supports classes with constructors, methods, fields, single inheritance, getters/setters, and parameter properties. Interfaces define typed object shapes and can be extended or implemented by classes.

**Key differences from TypeScript:**

- **No `instanceof`** — there are no runtime type tags
- **Static dispatch** — method calls are resolved at compile time, not dynamically
- **No interface methods on object literals** — in TypeScript you can define methods on interfaces and implement them with object literals (`{ greet() { ... } }`). In ChadScript, interfaces only define data layout (fields). If you need methods, use a class.
- **Access modifiers not enforced at runtime** — `private`/`protected` are parsed but all fields are accessible in the compiled output. Run `chad init` to get TypeScript type-checking in your editor, which will flag access violations before you compile.

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
console.log(c.getValue()); // 11
```

### Constructors

Constructors run when you use `new`. Memory is allocated automatically (garbage collected).

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

TypeScript's shorthand for declaring and assigning fields in the constructor:

```typescript
class User {
  constructor(private name: string, private age: number) {}

  greet(): string {
    return "Hello, " + this.name;
  }
}
```

The `private`, `public`, `protected`, and `readonly` modifiers on constructor parameters automatically create class fields and assign the values.

### Getters and Setters

```typescript
class Temperature {
  private celsius: number;

  constructor(c: number) {
    this.celsius = c;
  }

  get fahrenheit(): number {
    return this.celsius * 1.8 + 32;
  }

  set fahrenheit(f: number) {
    this.celsius = (f - 32) / 1.8;
  }
}
```

### Inheritance

Single inheritance via `extends`:

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

Interfaces define the shape of an object — what fields it has and their types.

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

### Field Ordering

Object literals are automatically reordered to match the interface's declared field order. You can write fields in any order:

```typescript
const p: Person = { age: 30, city: "NYC", name: "Alice" }; // works fine
```

### Interface Inheritance

Interfaces can extend other interfaces:

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

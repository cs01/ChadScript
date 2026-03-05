# Classes & Interfaces

Classes and interfaces work like standard TypeScript with a few differences.

**Key differences from TypeScript:**

- **No `instanceof`** — there are no runtime type tags
- **Static dispatch** — method calls are resolved at compile time, not dynamically
- **Interfaces are data-only** — interfaces define fields, not methods. To attach methods to a type, use a class.
- **Access modifiers not enforced at runtime** — `private`/`protected` are parsed but all fields are accessible in the compiled output. Run `chad init` to get TypeScript type-checking in your editor, which will flag access violations before you compile.

## What's Supported

| Feature | Status |
|---------|--------|
| Properties (typed fields) | Supported |
| Constructors | Supported |
| Parameter properties | Supported |
| Instance methods | Supported |
| Getters / setters | Supported |
| `extends` (single inheritance) | Supported |
| `implements` | Supported |
| Interface inheritance (`extends`) | Supported |
| Static methods and fields | Supported |
| Abstract classes | Not yet supported |
| Decorators | Not supported |

## Field Ordering

One ChadScript-specific detail: object literals are automatically reordered to match the declared field order. You can write fields in any order:

```typescript
type Person = {
  name: string;
  age: number;
  city: string;
};

const p: Person = { age: 30, city: "NYC", name: "Alice" }; // works fine
```

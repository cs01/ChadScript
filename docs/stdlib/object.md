# Object

Static methods for working with objects and interfaces.

## `Object.keys(obj)`

Returns an array of the object's own property names.

```typescript
type User = {
  name: string;
  age: number;
};

const user: User = { name: "Alice", age: 30 };
const keys = Object.keys(user);
// ["name", "age"]
```

## `Object.values(obj)`

Returns an array of the object's own property values as strings.

```typescript
const values = Object.values(user);
// ["Alice", "30"]
```

## `Object.entries(obj)`

Returns an array of alternating key/value strings.

```typescript
const entries = Object.entries(user);
// ["name", "Alice", "age", "30"]
```

## `typeof`

Check the runtime type of a value.

```typescript
typeof "hello"    // "string"
typeof 42         // "number"
typeof true       // "boolean"
typeof user       // "object"
```

# Set

Collection of unique values.

## Constructor

```typescript
const s = new Set<string>();
```

## Methods

### `s.add(value)`

```typescript
s.add("hello");
s.add("world");
s.add("hello");    // no-op, already exists
```

### `s.has(value)`

```typescript
if (s.has("hello")) {
  console.log("found");
}
```

### `s.delete(value)`

```typescript
s.delete("hello");    // boolean
```

### `s.size`

```typescript
console.log(s.size);    // number of unique elements
```

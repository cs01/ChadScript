# Map

Key-value map using parallel arrays internally.

## Constructor

```typescript
const m = new Map<string, number>();
```

## Methods

### `m.set(key, value)`

```typescript
m.set("alice", 42);
m.set("bob", 99);
```

### `m.get(key)`

```typescript
const val = m.get("alice");    // 42
```

### `m.has(key)`

```typescript
if (m.has("alice")) {
  console.log("found");
}
```

### `m.delete(key)`

```typescript
m.delete("alice");    // boolean
```

### `m.clear()`

```typescript
m.clear();
```

### `m.size`

```typescript
console.log(m.size);    // number of entries
```

## LLVM Struct

```
%StringMap = type { i8**, i8**, i32, i32 }
```

Fields: `keys` array, `values` array, `size`, `capacity`. Uses parallel arrays with linear scan — optimized for small to medium maps.

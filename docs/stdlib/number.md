# Number

Number utilities. All numbers in ChadScript are 64-bit IEEE 754 doubles.

## Static Methods

### `Number.isFinite(x)`

```typescript
Number.isFinite(42);         // true
Number.isFinite(1/0);        // false
```

### `Number.isNaN(x)`

```typescript
Number.isNaN(0/0);           // true
Number.isNaN(42);            // false
```

### `Number.isInteger(x)`

```typescript
Number.isInteger(42);        // true
Number.isInteger(42.5);      // false
```

## Instance Methods

### `x.toString()`

```typescript
const n = 42;
const s = n.toString();      // "42"
```

## Global Functions

### `parseInt(str, radix?)`

```typescript
const n = parseInt("42");        // 42
const hex = parseInt("ff", 16);  // 255
```

### `parseFloat(str)`

```typescript
const f = parseFloat("3.14");   // 3.14
```

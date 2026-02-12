# Array Methods

Arrays in ChadScript are heap-allocated structs: `{ data_ptr, length, capacity }`. They grow dynamically with `push()`.

## Properties

### `arr.length`

```typescript
const arr = [1, 2, 3];
console.log(arr.length);    // 3
```

## Mutating Methods

### `arr.push(element)`

```typescript
const arr: number[] = [];
arr.push(42);
arr.push(99);
console.log(arr.length);    // 2
```

### `arr.pop()`

```typescript
const last = arr.pop();     // removes and returns last element
```

### `arr.shift()`

```typescript
const first = arr.shift();  // removes and returns first element
```

### `arr.splice(start, deleteCount)`

```typescript
arr.splice(1, 2);           // remove 2 elements starting at index 1
```

## Searching

```typescript
arr.includes(element)       // boolean
arr.indexOf(element)        // number — index or -1
arr.find(fn)                // element or undefined
arr.some(fn)                // boolean — true if any match
arr.every(fn)               // boolean — true if all match
```

## Transforming

```typescript
arr.map(fn)                 // new array with transformed elements
arr.filter(fn)              // new array with matching elements
arr.reduce(fn, init?)       // accumulated value
arr.forEach(fn)             // void — iterate without return
```

## Extracting & Combining

```typescript
arr.slice(start?, end?)     // new array (shallow copy of range)
arr.concat(other)           // new array combining both
arr.join(separator?)        // string — join elements
```

## Static Methods

### `Array.isArray(value)`

```typescript
Array.isArray([1, 2, 3]);   // true
Array.isArray("hello");     // false
```

## Example

```typescript
const nums = [1, 2, 3, 4, 5];

const doubled = nums.map((n: number) => n * 2);
// [2, 4, 6, 8, 10]

const evens = nums.filter((n: number) => n % 2 == 0);
// [2, 4]

const sum = nums.reduce((acc: number, n: number) => acc + n, 0);
// 15

const found = nums.find((n: number) => n > 3);
// 4
```

## LLVM Struct

```
%Array = type { double*, i32, i32 }       ; number[]
%StringArray = type { i8**, i32, i32 }    ; string[]
```

Fields: `data` (pointer to elements), `length`, `capacity`.

# Math

Mathematical operations. Most map directly to LLVM intrinsics for maximum performance.

## Functions

```typescript
Math.sqrt(x)        // Square root
Math.pow(x, y)      // x raised to power y
Math.floor(x)       // Round down
Math.ceil(x)        // Round up
Math.round(x)       // Round to nearest integer
Math.abs(x)         // Absolute value
Math.max(a, b)      // Larger of two values
Math.min(a, b)      // Smaller of two values
Math.random()       // Random double in [0, 1)
Math.log(x)         // Natural logarithm
Math.log2(x)        // Base-2 logarithm
Math.log10(x)       // Base-10 logarithm
Math.sin(x)         // Sine
Math.cos(x)         // Cosine
Math.tan(x)         // Tangent
Math.trunc(x)       // Truncate to integer (toward zero)
Math.sign(x)        // Returns -1, 0, or 1
```

## Constants

```typescript
Math.PI              // 3.141592653589793
Math.E               // 2.718281828459045
```

## Example

```typescript
const hypotenuse = Math.sqrt(Math.pow(3, 2) + Math.pow(4, 2));
console.log(hypotenuse);    // 5.000000

const clamped = Math.max(0, Math.min(100, value));
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `Math.floor()` | `@llvm.floor.f64` intrinsic |
| `Math.ceil()` | `@llvm.ceil.f64` intrinsic |
| `Math.sqrt()` | `@llvm.sqrt.f64` intrinsic |
| `Math.pow()` | `@llvm.pow.f64` intrinsic |
| `Math.abs()` | `@llvm.fabs.f64` intrinsic |
| `Math.sin()` etc. | `libm` functions |
| `Math.random()` | `rand() / RAND_MAX` |

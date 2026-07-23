// Number.* numeric constants (compile-time literals).
console.log(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
console.log(Number.MAX_VALUE, Number.MIN_VALUE);
console.log(Number.EPSILON);
console.log(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN);
console.log(Number.isInteger(Number.MAX_SAFE_INTEGER), Number.isFinite(Number.MAX_VALUE));
console.log(Number.isNaN(Number.NaN), Number.isFinite(Number.POSITIVE_INFINITY));
console.log(Number.MAX_SAFE_INTEGER + 1 === Number.MAX_SAFE_INTEGER + 2);

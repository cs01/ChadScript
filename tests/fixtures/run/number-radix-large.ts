// @known-bug: toString(radix) diverges from V8 for |x| >= 2^53 (inherited from the v1 port of DoubleToRadixCString)
console.log((-30778992176055908).toString(36));
console.log((1152921504606846976).toString(36), (9007199254740994).toString(7));
console.log((123456789.125).toString(36));

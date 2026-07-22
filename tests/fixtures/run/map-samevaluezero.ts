const nk = new Map<number, string>();
nk.set(NaN, "nan-val");
nk.set(-0, "zero-val");
console.log(nk.get(NaN) ?? "?");
console.log(nk.get(0) ?? "?");
console.log(nk.size);
console.log(Infinity > 1e308);

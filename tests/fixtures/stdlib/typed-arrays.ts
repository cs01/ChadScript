const u8 = new Uint8Array(5);
u8[0] = 10;
u8[1] = 20;
u8[2] = 30;
u8[3] = 255;
u8[4] = 0;
console.log(u8[0]);
console.log(u8[1]);
console.log(u8[2]);
console.log(u8[3]);
console.log(u8[4]);
console.log(u8.length);

const f64 = new Float64Array(3);
f64[0] = 3.14;
f64[1] = -2.718;
f64[2] = 0;
console.log(f64[0]);
console.log(f64[1]);
console.log(f64[2]);
console.log(f64.length);

const u8b = Uint8Array.from([1, 2, 3, 4, 5]);
console.log(u8b.length);
console.log(u8b[0]);
console.log(u8b[4]);

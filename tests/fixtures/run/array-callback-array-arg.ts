// A callback that declares the third (reduce: fourth) parameter receives the array itself.
const xs = [3, 4, 5];
xs.forEach((v, i, a) => console.log(v, i, a.length, a === xs));
console.log(xs.map((v, i, a) => v + i + a.length));
console.log(xs.filter((v, _i, a) => v > (a[0] ?? 0)));
console.log(
  xs.some((_v, i, a) => i === a.length - 1),
  xs.every((v, _i, a) => a.includes(v)),
);
console.log(
  xs.find((v, i, a) => a[i + 1] === v + 1),
  xs.findIndex((_v, i, a) => a[i] === 5),
);
console.log(xs.reduce((acc, v, i, a) => acc + v * i + a.length, 0));
console.log(xs.flatMap((v, _i, a) => [v, a.length]));

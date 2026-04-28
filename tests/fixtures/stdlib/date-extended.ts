const d = new Date(1704067200000);

console.log(d.getMilliseconds());
console.log(d.valueOf());

d.setFullYear(2025);
console.log(d.getFullYear());

d.setMonth(5);
console.log(d.getMonth());

d.setDate(15);
console.log(d.getDate());

d.setHours(10);
console.log(d.getHours());

d.setMinutes(30);
console.log(d.getMinutes());

d.setSeconds(45);
console.log(d.getSeconds());

const d2 = new Date(1704067200123);
console.log(d2.getMilliseconds());

console.log(d2.toTimeString().length > 0);
console.log(d2.toDateString().length > 0);

console.log(typeof d.getTimezoneOffset());

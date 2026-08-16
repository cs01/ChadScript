// @expect-reject: CS1214
// Without an annotation the target shape is unknown and lib's signature returns `any`, which is
// not in the type domain.
const raw = JSON.parse('{"x":1}');
console.log(raw);

// @expect-reject: CS1240
// A `number | undefined` parameter is a boxed pointer; the loop passes a raw number, and no word
// conversion turns one into the other.
[1, 2].forEach((x: number | undefined) => console.log(x));

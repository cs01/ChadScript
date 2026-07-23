// @expect-reject: CS1215
// `Date.now()` is in the subset; the rest of the Date surface is not — parsing needs a calendar.
const t = Date.parse("2020-01-01");
console.log(t);

const nums = [1, 2, 3, 4, 5]
const r1 = nums.includes(3)
const r2 = nums.includes(99)

const strs = ["hello", "world"]
const r3 = strs.includes("hello")
const r4 = strs.includes("nope")

if (r1 === true && r2 === false && r3 === true && r4 === false) {
  console.log("TEST_PASSED")
} else {
  console.log("FAIL")
}

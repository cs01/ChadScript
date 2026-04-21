// @test-description: null is distinct from empty string under ===
const empty: string = "";
const missing: string | null = null;

// Per #599 requirement 5: `empty === missing` must be false.
let passed = true;
if ((empty as string | null) === missing) passed = false;
if (missing === (empty as string | null)) passed = false;
if (missing !== null) passed = false;
if (empty === null) passed = false;

if (passed) console.log("TEST_PASSED");

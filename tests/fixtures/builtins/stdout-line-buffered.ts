// @test expectTestPassed
// Regression for dapweb NOTES #13: with stdout redirected to a pipe/file
// and the program pinned inside a long event loop, console.log output was
// silently buffered (full-buffering on non-TTY) and never appeared until
// exit. Main now calls setvbuf(..., _IOLBF, 0) on stdout and stderr so
// each newline-terminated print flushes promptly.
//
// The fixture itself just exits fast, so the test harness only verifies
// that setvbuf doesn't break anything. The real behavior is visible when
// piping: `./bin > out &; sleep 1; wc -c out` — should show bytes
// immediately, not only after the child exits.
console.log("TEST_PASSED");

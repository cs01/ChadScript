// @test-compile-error: Map<object, string> is not supported
// @test-description: Map with generic object key type should give a clear error

const m = new Map<object, string>();

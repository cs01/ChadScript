// @test-description: v8 mixed-mode — normal-mode ts calling jshandle externs
// @test-skip

declare function cs_v8_eval_handle(src: string): number;
declare function cs_v8_handle_get_property(h: number, name: string): number;
declare function cs_v8_handle_to_number(h: number): number;
declare function cs_v8_handle_to_string(h: number): string;
declare function cs_v8_handle_release(h: number): void;
declare function cs_v8_is_handle(v: number): number;
declare function cs_v8_handle_table_size(): number;
declare function cs_v8_last_error(): string;

function fail(msg: string): void {
  console.log("TEST_FAILED: " + msg);
}

const obj = cs_v8_eval_handle("({name: 'chad', count: 42})");
if (obj === 0) {
  fail("eval_handle returned 0: " + cs_v8_last_error());
} else if (cs_v8_is_handle(obj) !== 1) {
  fail("eval_handle result is not a tagged jshandle");
} else {
  const name_h = cs_v8_handle_get_property(obj, "name");
  const count_h = cs_v8_handle_get_property(obj, "count");
  const name = cs_v8_handle_to_string(name_h);
  const count = cs_v8_handle_to_number(count_h);
  if (name !== "chad") {
    fail("expected name='chad', got '" + name + "'");
  } else if (count !== 42) {
    fail("expected count=42, got " + count.toString());
  } else {
    cs_v8_handle_release(name_h);
    cs_v8_handle_release(count_h);
    cs_v8_handle_release(obj);
    const remaining = cs_v8_handle_table_size();
    if (remaining !== 0) {
      fail("expected empty handle table, got " + remaining.toString());
    } else {
      console.log("TEST_PASSED");
    }
  }
}

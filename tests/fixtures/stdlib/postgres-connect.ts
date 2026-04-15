// @test-requires-env: PG_TESTS_ENABLED
import { Client } from "chadscript/postgres";

const c = new Client("host=127.0.0.1 port=5432 user=postgres password=test dbname=chadtest");
c.connect();
c.end();
console.log("TEST_PASSED");

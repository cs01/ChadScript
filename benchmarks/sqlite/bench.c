// Apples-to-apples vs the Go bench: prepare ONE statement, bind the int
// parameter per iteration, reset between calls. SQLite's statement cache
// lookup gets exercised the same way Go's database/sql layer exercises it.
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sqlite3.h>

int main() {
    sqlite3 *db;
    sqlite3_open(":memory:", &db);

    sqlite3_exec(db, "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)", NULL, NULL, NULL);

    sqlite3_stmt *ins;
    sqlite3_prepare_v2(db, "INSERT INTO t VALUES (?, ?)", -1, &ins, NULL);
    char buf[32];
    for (int i = 0; i < 100; i++) {
        snprintf(buf, sizeof(buf), "value_%d", i);
        sqlite3_bind_int(ins, 1, i);
        sqlite3_bind_text(ins, 2, buf, -1, SQLITE_TRANSIENT);
        sqlite3_step(ins);
        sqlite3_reset(ins);
    }
    sqlite3_finalize(ins);

    sqlite3_stmt *sel;
    sqlite3_prepare_v2(db, "SELECT val FROM t WHERE id = ?", -1, &sel, NULL);

    int iterations = 100000;
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    for (int j = 0; j < iterations; j++) {
        sqlite3_bind_int(sel, 1, j % 100);
        sqlite3_step(sel);
        sqlite3_reset(sel);
    }

    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = (end.tv_sec - start.tv_sec) + (end.tv_nsec - start.tv_nsec) / 1e9;
    int qps = (int)(iterations / elapsed);
    printf("Queries:  %d\n", iterations);
    printf("Time:     %.3fs\n", elapsed);
    printf("QPS:      %d\n", qps);

    sqlite3_finalize(sel);
    sqlite3_close(db);
    return 0;
}

#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sqlite3.h>

int main() {
    sqlite3 *db;
    sqlite3_open(":memory:", &db);

    sqlite3_exec(db, "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)", NULL, NULL, NULL);

    char sql[128];
    for (int i = 0; i < 100; i++) {
        snprintf(sql, sizeof(sql), "INSERT INTO t VALUES (%d, 'value_%d')", i, i);
        sqlite3_exec(db, sql, NULL, NULL, NULL);
    }

    int iterations = 100000;
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    for (int j = 0; j < iterations; j++) {
        int id = j % 100;
        snprintf(sql, sizeof(sql), "SELECT val FROM t WHERE id = %d", id);
        sqlite3_stmt *stmt;
        sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = (end.tv_sec - start.tv_sec) + (end.tv_nsec - start.tv_nsec) / 1e9;
    int qps = (int)(iterations / elapsed);
    printf("Queries:  %d\n", iterations);
    printf("Time:     %.3fs\n", elapsed);
    printf("QPS:      %d\n", qps);

    sqlite3_close(db);
    return 0;
}

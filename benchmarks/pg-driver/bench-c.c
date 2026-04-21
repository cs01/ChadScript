// libpq C benchmark (ceiling reference).
// Build: cc bench-c.c -I$(brew --prefix libpq)/include -L$(brew --prefix libpq)/lib -lpq -O2 -o /tmp/bench-c
// Run:   /tmp/bench-c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <libpq-fe.h>

#define ITERS 10000
#define RUNS  3

static long long run_once(const char *conninfo) {
    PGconn *c = PQconnectdb(conninfo);
    if (PQstatus(c) != CONNECTION_OK) {
        fprintf(stderr, "connect fail: %s\n", PQerrorMessage(c));
        return 0;
    }
    PQclear(PQexec(c, "SELECT 1"));
    struct timeval t0, t1;
    gettimeofday(&t0, NULL);
    for (int i = 0; i < ITERS; i++) {
        PGresult *r = PQexec(c, "SELECT 1");
        PQclear(r);
    }
    gettimeofday(&t1, NULL);
    PQfinish(c);
    long long ms = (t1.tv_sec - t0.tv_sec) * 1000LL + (t1.tv_usec - t0.tv_usec) / 1000LL;
    return ms;
}

static int cmp(const void *a, const void *b) {
    long long aa = *(long long*)a, bb = *(long long*)b;
    return aa < bb ? -1 : aa > bb ? 1 : 0;
}

int main(void) {
    const char *user = getenv("PGUSER"); if (!user) user = "postgres";
    const char *db   = getenv("PGDATABASE"); if (!db) db = "postgres";
    const char *pw   = getenv("PGPASSWORD"); if (!pw) pw = "";
    char conninfo[512];
    snprintf(conninfo, sizeof(conninfo),
             "host=127.0.0.1 port=5432 user=%s dbname=%s password=%s",
             user, db, pw);
    long long results[RUNS];
    for (int r = 0; r < RUNS; r++) {
        results[r] = run_once(conninfo);
        if (results[r] == 0) return 1;
    }
    qsort(results, RUNS, sizeof(long long), cmp);
    long long mid = results[1];
    printf("c-libpq iters=%d runs=%d\n", ITERS, RUNS);
    printf("runs_ms=%lld,%lld,%lld\n", results[0], results[1], results[2]);
    printf("median_ms=%lld qps=%lld\n", mid, (long long)(ITERS * 1000LL / mid));
    return 0;
}

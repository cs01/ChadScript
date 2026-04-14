#include <libpq-fe.h>
#include <stdlib.h>
#include <string.h>

extern void *GC_malloc_atomic(size_t);

static const char *gc_strdup(const char *s) {
    if (!s) return "";
    size_t n = strlen(s);
    char *out = (char *)GC_malloc_atomic(n + 1);
    memcpy(out, s, n + 1);
    return out;
}

void *cs_pg_connect(const char *conninfo) {
    if (!conninfo) return NULL;
    PGconn *conn = PQconnectdb(conninfo);
    return (void *)conn;
}

double cs_pg_status(void *conn) {
    if (!conn) return (double)CONNECTION_BAD;
    return (double)PQstatus((PGconn *)conn);
}

const char *cs_pg_error_message(void *conn) {
    if (!conn) return "null connection";
    return gc_strdup(PQerrorMessage((PGconn *)conn));
}

void cs_pg_finish(void *conn) {
    if (!conn) return;
    PQfinish((PGconn *)conn);
}

void *cs_pg_exec(void *conn, const char *sql) {
    if (!conn || !sql) return NULL;
    return (void *)PQexec((PGconn *)conn, sql);
}

void *cs_pg_exec_params(void *conn, const char *sql, double nparams, const char **values) {
    if (!conn || !sql) return NULL;
    return (void *)PQexecParams((PGconn *)conn, sql, (int)nparams, NULL, values, NULL, NULL, 0);
}

double cs_pg_result_status(void *res) {
    if (!res) return (double)PGRES_FATAL_ERROR;
    return (double)PQresultStatus((PGresult *)res);
}

const char *cs_pg_result_error_message(void *res) {
    if (!res) return "null result";
    return gc_strdup(PQresultErrorMessage((PGresult *)res));
}

double cs_pg_nrows(void *res) {
    if (!res) return 0.0;
    return (double)PQntuples((PGresult *)res);
}

double cs_pg_ncols(void *res) {
    if (!res) return 0.0;
    return (double)PQnfields((PGresult *)res);
}

const char *cs_pg_fname(void *res, double col) {
    if (!res) return "";
    const char *n = PQfname((PGresult *)res, (int)col);
    return gc_strdup(n ? n : "");
}

double cs_pg_ftype(void *res, double col) {
    if (!res) return 0.0;
    return (double)PQftype((PGresult *)res, (int)col);
}

const char *cs_pg_getvalue(void *res, double row, double col) {
    if (!res) return "";
    return gc_strdup(PQgetvalue((PGresult *)res, (int)row, (int)col));
}

double cs_pg_getisnull(void *res, double row, double col) {
    if (!res) return 1.0;
    return (double)PQgetisnull((PGresult *)res, (int)row, (int)col);
}

const char *cs_pg_cmdtuples(void *res) {
    if (!res) return "0";
    const char *c = PQcmdTuples((PGresult *)res);
    return gc_strdup((c && *c) ? c : "0");
}

void cs_pg_clear(void *res) {
    if (!res) return;
    PQclear((PGresult *)res);
}

double cs_pg_result_ok(void *res) {
    if (!res) return 0.0;
    ExecStatusType s = PQresultStatus((PGresult *)res);
    return (s == PGRES_COMMAND_OK || s == PGRES_TUPLES_OK) ? 1.0 : 0.0;
}

#include <libpq-fe.h>
#include <stdlib.h>
#include <string.h>

void *cs_pg_connect(const char *conninfo) {
    if (!conninfo) return NULL;
    PGconn *conn = PQconnectdb(conninfo);
    return (void *)conn;
}

int cs_pg_status(void *conn) {
    if (!conn) return CONNECTION_BAD;
    return PQstatus((PGconn *)conn);
}

const char *cs_pg_error_message(void *conn) {
    if (!conn) return "null connection";
    return PQerrorMessage((PGconn *)conn);
}

void cs_pg_finish(void *conn) {
    if (!conn) return;
    PQfinish((PGconn *)conn);
}

void *cs_pg_exec(void *conn, const char *sql) {
    if (!conn || !sql) return NULL;
    return (void *)PQexec((PGconn *)conn, sql);
}

void *cs_pg_exec_params(void *conn, const char *sql, int nparams, const char **values) {
    if (!conn || !sql) return NULL;
    return (void *)PQexecParams((PGconn *)conn, sql, nparams, NULL, values, NULL, NULL, 0);
}

int cs_pg_result_status(void *res) {
    if (!res) return PGRES_FATAL_ERROR;
    return PQresultStatus((PGresult *)res);
}

const char *cs_pg_result_error_message(void *res) {
    if (!res) return "null result";
    return PQresultErrorMessage((PGresult *)res);
}

int cs_pg_nrows(void *res) {
    if (!res) return 0;
    return PQntuples((PGresult *)res);
}

int cs_pg_ncols(void *res) {
    if (!res) return 0;
    return PQnfields((PGresult *)res);
}

const char *cs_pg_fname(void *res, int col) {
    if (!res) return "";
    const char *n = PQfname((PGresult *)res, col);
    return n ? n : "";
}

unsigned int cs_pg_ftype(void *res, int col) {
    if (!res) return 0;
    return (unsigned int)PQftype((PGresult *)res, col);
}

const char *cs_pg_getvalue(void *res, int row, int col) {
    if (!res) return "";
    return PQgetvalue((PGresult *)res, row, col);
}

int cs_pg_getisnull(void *res, int row, int col) {
    if (!res) return 1;
    return PQgetisnull((PGresult *)res, row, col);
}

const char *cs_pg_cmdtuples(void *res) {
    if (!res) return "0";
    const char *c = PQcmdTuples((PGresult *)res);
    return (c && *c) ? c : "0";
}

void cs_pg_clear(void *res) {
    if (!res) return;
    PQclear((PGresult *)res);
}

int cs_pg_result_ok(void *res) {
    if (!res) return 0;
    ExecStatusType s = PQresultStatus((PGresult *)res);
    return (s == PGRES_COMMAND_OK || s == PGRES_TUPLES_OK) ? 1 : 0;
}

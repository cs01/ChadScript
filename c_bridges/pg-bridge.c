#include <libpq-fe.h>
#include <stdlib.h>
#include <string.h>

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
    return PQresultErrorMessage((PGresult *)res);
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
    return n ? n : "";
}

double cs_pg_ftype(void *res, double col) {
    if (!res) return 0.0;
    return (double)PQftype((PGresult *)res, (int)col);
}

const char *cs_pg_getvalue(void *res, double row, double col) {
    if (!res) return "";
    return PQgetvalue((PGresult *)res, (int)row, (int)col);
}

double cs_pg_getisnull(void *res, double row, double col) {
    if (!res) return 1.0;
    return (double)PQgetisnull((PGresult *)res, (int)row, (int)col);
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

double cs_pg_result_ok(void *res) {
    if (!res) return 0.0;
    ExecStatusType s = PQresultStatus((PGresult *)res);
    return (s == PGRES_COMMAND_OK || s == PGRES_TUPLES_OK) ? 1.0 : 0.0;
}

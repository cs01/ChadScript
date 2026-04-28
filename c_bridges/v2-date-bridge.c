#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

typedef struct {
    double timestamp;
} CS2Date;

double cs2_date_now(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
}

CS2Date *cs2_date_new(double ms) {
    CS2Date *d = (CS2Date *)malloc(sizeof(CS2Date));
    d->timestamp = ms;
    return d;
}

CS2Date *cs2_date_new_now(void) {
    return cs2_date_new(cs2_date_now());
}

double cs2_date_get_time(CS2Date *d) {
    return d->timestamp;
}

double cs2_date_get_full_year(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)(t->tm_year + 1900);
}

double cs2_date_get_month(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_mon;
}

double cs2_date_get_date(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_mday;
}

double cs2_date_get_hours(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_hour;
}

double cs2_date_get_minutes(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_min;
}

double cs2_date_get_seconds(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_sec;
}

double cs2_date_get_day(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    return (double)t->tm_wday;
}

char *cs2_date_to_iso_string(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    int ms = (int)(d->timestamp - (double)secs * 1000.0);
    if (ms < 0) ms = 0;
    struct tm *t = gmtime(&secs);
    char *buf = (char *)malloc(32);
    snprintf(buf, 32, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
        t->tm_hour, t->tm_min, t->tm_sec, ms);
    return buf;
}

char *cs2_date_to_string(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    char *buf = (char *)malloc(64);
    strftime(buf, 64, "%a %b %d %Y %H:%M:%S", t);
    return buf;
}

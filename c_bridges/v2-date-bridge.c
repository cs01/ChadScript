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

double cs2_date_get_milliseconds(CS2Date *d) {
    double secs_floor = (double)((long long)(d->timestamp / 1000.0)) * 1000.0;
    double ms = d->timestamp - secs_floor;
    if (ms < 0) ms += 1000;
    return (double)((int)ms);
}

double cs2_date_get_timezone_offset(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm local_tm;
    struct tm utc_tm;
    localtime_r(&secs, &local_tm);
    gmtime_r(&secs, &utc_tm);
    time_t local_t = mktime(&local_tm);
    time_t utc_t = mktime(&utc_tm);
    return (double)((utc_t - local_t) / 60);
}

double cs2_date_value_of(CS2Date *d) {
    return d->timestamp;
}

void cs2_date_set_time(CS2Date *d, double ms) {
    d->timestamp = ms;
}

void cs2_date_set_full_year(CS2Date *d, double year) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_year = (int)year - 1900;
    d->timestamp = (double)mktime(t) * 1000.0;
}

void cs2_date_set_month(CS2Date *d, double month) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_mon = (int)month;
    d->timestamp = (double)mktime(t) * 1000.0;
}

void cs2_date_set_date(CS2Date *d, double day) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_mday = (int)day;
    d->timestamp = (double)mktime(t) * 1000.0;
}

void cs2_date_set_hours(CS2Date *d, double hours) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_hour = (int)hours;
    d->timestamp = (double)mktime(t) * 1000.0;
}

void cs2_date_set_minutes(CS2Date *d, double minutes) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_min = (int)minutes;
    d->timestamp = (double)mktime(t) * 1000.0;
}

void cs2_date_set_seconds(CS2Date *d, double seconds) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    t->tm_sec = (int)seconds;
    d->timestamp = (double)mktime(t) * 1000.0;
}

char *cs2_date_to_date_string(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    char *buf = (char *)malloc(32);
    strftime(buf, 32, "%a %b %d %Y", t);
    return buf;
}

char *cs2_date_to_time_string(CS2Date *d) {
    time_t secs = (time_t)(d->timestamp / 1000.0);
    struct tm *t = localtime(&secs);
    char *buf = (char *)malloc(16);
    snprintf(buf, 16, "%02d:%02d:%02d", t->tm_hour, t->tm_min, t->tm_sec);
    return buf;
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

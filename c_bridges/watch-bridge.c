// watch-bridge.c — Directory-tree file watcher for `chad watch`.
// Provides cs_watch_loop(chad_binary, source_file, output_binary) which
// watches the directory tree rooted at dirname(source_file) for file changes,
// then recompiles and reruns on each change.
//
// Three backends: inotify (Linux), kqueue (macOS), poll (fallback).
// Watches all file types (so embedded .css, .html, .json etc. trigger rebuilds)
// but skips build artifacts (.o, .ll, .bc) and excluded dirs (.build, etc.).
// 50ms debounce prevents rapid re-triggers.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <dirent.h>
#include <libgen.h>
#include <limits.h>
#include <errno.h>

// --- Shared helpers ---

static int is_excluded_dir(const char *name) {
    return (strcmp(name, ".build") == 0 ||
            strcmp(name, "node_modules") == 0 ||
            strcmp(name, "vendor") == 0 ||
            strcmp(name, ".git") == 0 ||
            strcmp(name, "dist") == 0);
}

// Skip build artifacts — we want to rebuild on any source/asset change
// (.ts, .js, .css, .html, .json, etc.) but not on compiler intermediates
static int is_build_artifact(const char *name) {
    size_t len = strlen(name);
    if (len >= 2 && strcmp(name + len - 2, ".o") == 0) return 1;
    if (len >= 3 && strcmp(name + len - 3, ".ll") == 0) return 1;
    if (len >= 3 && strcmp(name + len - 3, ".bc") == 0) return 1;
    if (len >= 2 && strcmp(name + len - 2, ".a") == 0) return 1;
    if (len >= 3 && strcmp(name + len - 3, ".so") == 0) return 1;
    if (len >= 6 && strcmp(name + len - 6, ".dylib") == 0) return 1;
    return 0;
}

// Current child process PID (0 = none running)
static volatile pid_t child_pid = 0;
static volatile int watch_running = 1;

static void kill_child(void) {
    if (child_pid > 0) {
        kill(child_pid, SIGTERM);
        waitpid(child_pid, NULL, 0);
        child_pid = 0;
    }
}

// Compile and run: fork the output binary, track PID for cleanup
static void compile_and_run(const char *chad_binary, const char *source_file,
                            const char *output_binary) {
    kill_child();

    printf("\033[2J\033[H");  // clear screen
    printf("[watch] recompiling %s...\n", source_file);
    fflush(stdout);

    // Compile
    pid_t pid = fork();
    if (pid == 0) {
        execl(chad_binary, chad_binary, "build", source_file, "-o", output_binary, NULL);
        _exit(127);
    }
    int status;
    waitpid(pid, &status, 0);
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        printf("[watch] compilation failed\n");
        fflush(stdout);
        return;
    }

    // Run
    printf("[watch] running %s\n\n", output_binary);
    fflush(stdout);
    pid = fork();
    if (pid == 0) {
        execl(output_binary, output_binary, NULL);
        _exit(127);
    }
    child_pid = pid;
}

// Returns current time in milliseconds (for debounce)
static long long now_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}


// ============================================================
// Linux: inotify-based watcher
// ============================================================
#ifdef __linux__
#include <sys/inotify.h>

#define MAX_WATCH_DIRS 512

// wd-to-path mapping so we can check filenames on events
static struct {
    int wd;
    char path[PATH_MAX];
} watch_dirs[MAX_WATCH_DIRS];
static int watch_count = 0;

static int ifd = -1;

static void add_watch_dir(const char *dirpath) {
    if (watch_count >= MAX_WATCH_DIRS) return;
    int wd = inotify_add_watch(ifd, dirpath,
                               IN_MODIFY | IN_CLOSE_WRITE | IN_CREATE);
    if (wd < 0) return;
    watch_dirs[watch_count].wd = wd;
    strncpy(watch_dirs[watch_count].path, dirpath, PATH_MAX - 1);
    watch_dirs[watch_count].path[PATH_MAX - 1] = '\0';
    watch_count++;
}

// Recursively walk directory tree, adding inotify watches on each dir
static void walk_and_watch(const char *dirpath) {
    add_watch_dir(dirpath);

    DIR *d = opendir(dirpath);
    if (!d) return;
    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.' &&
            (entry->d_name[1] == '\0' ||
             (entry->d_name[1] == '.' && entry->d_name[2] == '\0')))
            continue;
        if (entry->d_type == DT_DIR) {
            if (is_excluded_dir(entry->d_name)) continue;
            char subpath[PATH_MAX];
            snprintf(subpath, sizeof(subpath), "%s/%s", dirpath, entry->d_name);
            walk_and_watch(subpath);
        }
    }
    closedir(d);
}

static void watch_inotify(const char *chad_binary, const char *source_file,
                           const char *output_binary) {
    // Derive watch root from source_file's directory
    char src_copy[PATH_MAX];
    strncpy(src_copy, source_file, PATH_MAX - 1);
    src_copy[PATH_MAX - 1] = '\0';
    const char *watch_root = dirname(src_copy);

    ifd = inotify_init();
    if (ifd < 0) {
        perror("inotify_init");
        return;
    }

    walk_and_watch(watch_root);
    printf("[watch] watching %s (%d directories)\n", watch_root, watch_count);
    fflush(stdout);

    // Initial compile+run
    compile_and_run(chad_binary, source_file, output_binary);

    long long last_trigger = 0;
    char buf[4096] __attribute__((aligned(__alignof__(struct inotify_event))));

    for (;;) {
        ssize_t len = read(ifd, buf, sizeof(buf));
        if (len <= 0) break;

        int should_rebuild = 0;
        char *ptr = buf;
        while (ptr < buf + len) {
            struct inotify_event *event = (struct inotify_event *)ptr;

            // New subdirectory created — add a watch on it
            if ((event->mask & IN_CREATE) && (event->mask & IN_ISDIR)) {
                if (event->len > 0 && !is_excluded_dir(event->name)) {
                    // Find parent path from wd
                    for (int i = 0; i < watch_count; i++) {
                        if (watch_dirs[i].wd == event->wd) {
                            char newdir[PATH_MAX];
                            snprintf(newdir, sizeof(newdir), "%s/%s",
                                     watch_dirs[i].path, event->name);
                            walk_and_watch(newdir);
                            break;
                        }
                    }
                }
            }

            // File modified — rebuild unless it's a build artifact
            if ((event->mask & (IN_MODIFY | IN_CLOSE_WRITE)) && event->len > 0) {
                if (!is_build_artifact(event->name)) {
                    should_rebuild = 1;
                }
            }

            ptr += sizeof(struct inotify_event) + event->len;
        }

        if (should_rebuild) {
            long long now = now_ms();
            if (now - last_trigger >= 50) {  // 50ms debounce
                last_trigger = now;
                compile_and_run(chad_binary, source_file, output_binary);
            }
        }
    }

    close(ifd);
}

#endif // __linux__


// ============================================================
// macOS: kqueue-based watcher
// ============================================================
// Watches both directories (for new file creation) and individual source
// files (for in-place edits). kqueue's NOTE_WRITE on a directory fd only
// fires when directory entries change (create/delete/rename), NOT when
// an existing file's content is modified in-place. So we must also watch
// each source file directly to catch edits from all editors.
#ifdef __APPLE__
#include <sys/event.h>
#include <fcntl.h>

#define MAX_KQ_ENTRIES 2048

static struct {
    int fd;
    char path[PATH_MAX];
    int is_dir;
} kq_entries[MAX_KQ_ENTRIES];
static int kq_count = 0;

static int kqfd = -1;

static int kq_path_watched(const char *path) {
    for (int i = 0; i < kq_count; i++) {
        if (strcmp(kq_entries[i].path, path) == 0) return 1;
    }
    return 0;
}

static void add_kq_entry(const char *filepath, int is_dir) {
    if (kq_count >= MAX_KQ_ENTRIES) return;
    if (kq_path_watched(filepath)) return;

    int flags = O_RDONLY;
    if (is_dir) flags |= O_DIRECTORY;
    int fd = open(filepath, flags);
    if (fd < 0) return;

    struct kevent ev;
    // Dirs: detect new files/deletions. Files: detect content edits.
    int fflags = is_dir
        ? (NOTE_WRITE | NOTE_EXTEND)
        : (NOTE_WRITE | NOTE_ATTRIB | NOTE_DELETE | NOTE_RENAME);
    EV_SET(&ev, fd, EVFILT_VNODE, EV_ADD | EV_CLEAR, fflags, 0, NULL);
    if (kevent(kqfd, &ev, 1, NULL, 0, NULL) < 0) {
        close(fd);
        return;
    }

    kq_entries[kq_count].fd = fd;
    strncpy(kq_entries[kq_count].path, filepath, PATH_MAX - 1);
    kq_entries[kq_count].path[PATH_MAX - 1] = '\0';
    kq_entries[kq_count].is_dir = is_dir;
    kq_count++;
}

static void walk_and_watch_kq(const char *dirpath) {
    add_kq_entry(dirpath, 1);

    DIR *d = opendir(dirpath);
    if (!d) return;
    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.' &&
            (entry->d_name[1] == '\0' ||
             (entry->d_name[1] == '.' && entry->d_name[2] == '\0')))
            continue;

        char fullpath[PATH_MAX];
        snprintf(fullpath, sizeof(fullpath), "%s/%s", dirpath, entry->d_name);

        if (entry->d_type == DT_DIR) {
            if (is_excluded_dir(entry->d_name)) continue;
            walk_and_watch_kq(fullpath);
        } else if (entry->d_type == DT_REG && !is_build_artifact(entry->d_name)) {
            add_kq_entry(fullpath, 0);
        }
    }
    closedir(d);
}

static void watch_kqueue(const char *chad_binary, const char *source_file,
                          const char *output_binary) {
    char src_copy[PATH_MAX];
    strncpy(src_copy, source_file, PATH_MAX - 1);
    src_copy[PATH_MAX - 1] = '\0';
    const char *watch_root = dirname(src_copy);

    kqfd = kqueue();
    if (kqfd < 0) {
        perror("kqueue");
        return;
    }

    walk_and_watch_kq(watch_root);
    int file_count = 0, dir_count = 0;
    for (int i = 0; i < kq_count; i++) {
        if (kq_entries[i].is_dir) dir_count++;
        else file_count++;
    }
    printf("[watch] watching %s (%d files, %d dirs)\n", watch_root, file_count, dir_count);
    fflush(stdout);

    compile_and_run(chad_binary, source_file, output_binary);

    long long last_trigger = 0;
    struct kevent events[16];

    for (;;) {
        // 200ms timeout to periodically pick up new files
        struct timespec timeout = { 0, 200000000 };
        int n = kevent(kqfd, NULL, 0, events, 16, &timeout);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }

        int should_rebuild = 0;
        for (int i = 0; i < n; i++) {
            int fd = (int)events[i].ident;
            for (int j = 0; j < kq_count; j++) {
                if (kq_entries[j].fd != fd) continue;

                if (kq_entries[j].is_dir) {
                    // Directory changed — scan for new files/subdirs
                    walk_and_watch_kq(kq_entries[j].path);
                    should_rebuild = 1;
                } else {
                    // Source file modified — trigger rebuild
                    should_rebuild = 1;

                    // If file was deleted/renamed (editor write-to-temp-then-rename),
                    // close stale fd and re-add watch if the file reappears
                    if (events[i].fflags & (NOTE_DELETE | NOTE_RENAME)) {
                        close(kq_entries[j].fd);
                        kq_entries[j].fd = -1;
                        // Try to re-open (editor may have recreated it)
                        int newfd = open(kq_entries[j].path, O_RDONLY);
                        if (newfd >= 0) {
                            struct kevent ev;
                            EV_SET(&ev, newfd, EVFILT_VNODE, EV_ADD | EV_CLEAR,
                                   NOTE_WRITE | NOTE_ATTRIB | NOTE_DELETE | NOTE_RENAME,
                                   0, NULL);
                            if (kevent(kqfd, &ev, 1, NULL, 0, NULL) >= 0) {
                                kq_entries[j].fd = newfd;
                            } else {
                                close(newfd);
                            }
                        }
                    }
                }
                break;
            }
        }

        if (should_rebuild) {
            long long now = now_ms();
            if (now - last_trigger >= 50) {
                last_trigger = now;
                compile_and_run(chad_binary, source_file, output_binary);
            }
        }
    }
}

#endif // __APPLE__


// ============================================================
// Fallback: poll-based watcher (stat all source/asset files)
// ============================================================

#define MAX_POLL_FILES 2048

static struct {
    char path[PATH_MAX];
    time_t mtime;
} poll_files[MAX_POLL_FILES];
static int poll_count = 0;

static void walk_and_stat(const char *dirpath) {
    DIR *d = opendir(dirpath);
    if (!d) return;
    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.' &&
            (entry->d_name[1] == '\0' ||
             (entry->d_name[1] == '.' && entry->d_name[2] == '\0')))
            continue;

        char fullpath[PATH_MAX];
        snprintf(fullpath, sizeof(fullpath), "%s/%s", dirpath, entry->d_name);

        struct stat st;
        if (stat(fullpath, &st) != 0) continue;

        if (S_ISDIR(st.st_mode)) {
            if (!is_excluded_dir(entry->d_name)) {
                walk_and_stat(fullpath);
            }
        } else if (S_ISREG(st.st_mode) && !is_build_artifact(entry->d_name)) {
            if (poll_count < MAX_POLL_FILES) {
                strncpy(poll_files[poll_count].path, fullpath, PATH_MAX - 1);
                poll_files[poll_count].path[PATH_MAX - 1] = '\0';
                poll_files[poll_count].mtime = st.st_mtime;
                poll_count++;
            }
        }
    }
    closedir(d);
}

static void watch_poll(const char *chad_binary, const char *source_file,
                        const char *output_binary) {
    char src_copy[PATH_MAX];
    strncpy(src_copy, source_file, PATH_MAX - 1);
    src_copy[PATH_MAX - 1] = '\0';
    const char *watch_root = dirname(src_copy);

    walk_and_stat(watch_root);
    printf("[watch] watching %s (%d files, poll mode)\n", watch_root, poll_count);
    fflush(stdout);

    compile_and_run(chad_binary, source_file, output_binary);

    for (;;) {
        usleep(500000);  // 500ms poll interval

        int changed = 0;
        for (int i = 0; i < poll_count; i++) {
            struct stat st;
            if (stat(poll_files[i].path, &st) == 0 &&
                st.st_mtime != poll_files[i].mtime) {
                poll_files[i].mtime = st.st_mtime;
                changed = 1;
            }
        }

        // Also re-scan for new files periodically
        if (!changed) {
            int old_count = poll_count;
            poll_count = 0;
            walk_and_stat(watch_root);
            if (poll_count != old_count) {
                // New files appeared, but don't rebuild unless content changed
            }
        }

        if (changed) {
            compile_and_run(chad_binary, source_file, output_binary);
        }
    }
}


// ============================================================
// Public API — cs_watch_loop
// ============================================================

static void sigint_handler(int sig) {
    (void)sig;
    watch_running = 0;
    kill_child();
    printf("\n[watch] stopped\n");
    _exit(0);
}

void cs_watch_loop(const char *chad_binary, const char *source_file,
                   const char *output_binary) {
    signal(SIGINT, sigint_handler);
    signal(SIGTERM, sigint_handler);

#ifdef __linux__
    watch_inotify(chad_binary, source_file, output_binary);
#elif defined(__APPLE__)
    watch_kqueue(chad_binary, source_file, output_binary);
#else
    watch_poll(chad_binary, source_file, output_binary);
#endif
}

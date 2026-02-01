#!/bin/bash

WATCH_DIR="${1:-.}"
EXCLUDE_PATTERN="node_modules|\.git|nohup\.out|\.swp$|~$"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

print_header() {
    echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${YELLOW}📝 Change detected at $(date '+%H:%M:%S')${RESET}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

show_diff() {
    local file="$1"

    if git ls-files --error-unmatch "$file" &>/dev/null; then
        echo -e "${BLUE}Modified:${RESET} $file"
        git diff --color=always "$file" 2>/dev/null | head -100
    elif [[ -f "$file" ]]; then
        echo -e "${GREEN}New file:${RESET} $file"
        echo -e "${GREEN}+++ $file${RESET}"
        head -50 "$file" | while IFS= read -r line; do
            echo -e "${GREEN}+ $line${RESET}"
        done
    fi
}

echo -e "${BOLD}${CYAN}🔍 Watching for changes in: $WATCH_DIR${RESET}"
echo -e "${YELLOW}Press Ctrl+C to stop${RESET}\n"

if command -v inotifywait &>/dev/null; then
    inotifywait -m -r -e modify,create,delete,move \
        --exclude "$EXCLUDE_PATTERN" \
        --format '%w%f|%e' \
        "$WATCH_DIR" 2>/dev/null | while IFS='|' read -r file event; do

        if [[ "$file" =~ ($EXCLUDE_PATTERN) ]]; then
            continue
        fi

        print_header
        echo -e "${BOLD}Event:${RESET} $event"
        echo -e "${BOLD}File:${RESET} $file"
        echo ""

        if [[ "$event" == *"DELETE"* ]]; then
            echo -e "${RED}Deleted:${RESET} $file"
        else
            show_diff "$file"
        fi
    done
else
    echo -e "${YELLOW}Note: inotifywait not found, using polling mode (slower)${RESET}"
    echo -e "${YELLOW}Install inotify-tools for instant detection${RESET}\n"

    last_status=""
    while true; do
        current_status=$(git status --porcelain 2>/dev/null)

        if [[ "$current_status" != "$last_status" ]] && [[ -n "$current_status" ]]; then
            print_header

            echo "$current_status" | while read -r status file; do
                case "$status" in
                    M|" M"|MM)
                        show_diff "$file"
                        ;;
                    A|"??")
                        echo -e "${GREEN}New:${RESET} $file"
                        ;;
                    D|" D")
                        echo -e "${RED}Deleted:${RESET} $file"
                        ;;
                    *)
                        echo -e "${YELLOW}Changed ($status):${RESET} $file"
                        ;;
                esac
                echo ""
            done

            echo -e "\n${BOLD}Full diff:${RESET}"
            git diff --color=always --stat 2>/dev/null
            echo ""
            git diff --color=always 2>/dev/null | head -150

            last_status="$current_status"
        fi

        sleep 1
    done
fi

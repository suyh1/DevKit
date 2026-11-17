# This script is sent through OpenSSH stdin with validated parameters.
set -eu
umask 077

fail() { printf '%s\n' "$*" >&2; exit 1; }
digest() { sha256sum | cut -d ' ' -f 1; }
regular() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %h -- "$1")" = 1 ]; }
lock() {
    lock_attempts=0
    while ! flock -n 9; do
        [ "$lock_attempts" -lt 5 ] || fail 'This resource is busy. Retry after refreshing.'
        lock_attempts=$((lock_attempts + 1))
        sleep 1
    done
}
bounds() {
    regular "$1" || fail 'Expected a regular file without links.'
    [ "$(stat -c %s -- "$1")" -le 524288 ] || fail 'Configuration exceeds 512 KiB.'
}
emit() {
    bounds "$1"
    printf 'file\n'
    head -c 524289 -- "$1" | base64 -w0
    printf '\n'
}

if [ "$action" = check ]; then
    [ "$(uname -s)" = Linux ] || fail 'The SSH target is not Linux.'
    for tool in realpath sha256sum base64 stat flock nohup xargs; do
        command -v "$tool" >/dev/null || fail "Required Linux command is missing: $tool"
    done
    printf 'devkit-ssh\n'
    exit 0
fi

case "$action" in
    config-list)
        if [ "$module" = jar ]; then
            [ "$(realpath -e -- "$directory")" = "$directory" ] || fail 'Use the actual JAR directory.'
            for candidate in "$directory"/*; do
                if [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
                    printf '%s\0' "${candidate##*/}"
                fi
            done
        fi
        exit 0
        ;;
    config-read|config-backup|config-save)
        if [ "$module" = jar ]; then
            [ "$(realpath -e -- "$directory")" = "$directory" ] || fail 'Use the actual JAR directory.'
        else
            file=$(realpath -e -- "$file")
        fi
        bounds "$file"
        backup_dir="$HOME/.devkit-ssh/config-backups"
        key=$(printf '%s' "$file" | digest)
        backup="$backup_dir/$key.bak"
        case "$action" in
            config-read) emit "$file" ;;
            config-backup)
                if [ -e "$backup" ]; then emit "$backup"; else printf 'missing\n'; fi
                ;;
            config-save)
                mkdir -p -- "$backup_dir"
                [ ! -L "$backup_dir" ] || fail 'The backup directory is a link.'
                exec 9>"$backup_dir/$key.lock"
                lock
                bounds "$file"
                [ "$(digest < "$file")" = "$expected" ] || fail 'Configuration changed. Read the disk version and review your draft before saving.'
                temp=$(mktemp -- "${file%/*}/.devkit-ssh.XXXXXXXX")
                saved=
                trap 'rm -f -- "$temp" ${saved:+"$saved"}' EXIT
                printf '%s' "$content" | base64 -d > "$temp"
                if cmp -s -- "$file" "$temp"; then emit "$file"; exit 0; fi
                saved=$(mktemp -- "$backup_dir/.devkit-ssh.XXXXXXXX")
                cp -- "$file" "$saved"
                [ "$(digest < "$saved")" = "$expected" ] || fail 'Configuration changed. Read it again before saving.'
                if [ "$(stat -c '%u:%g' -- "$temp")" != "$(stat -c '%u:%g' -- "$file")" ]; then
                    chown --reference="$file" -- "$temp"
                fi
                chmod --reference="$file" -- "$temp"
                mv -fT -- "$saved" "$backup"
                bounds "$file"
                [ "$(digest < "$file")" = "$expected" ] || fail 'Configuration changed. Read it again before saving.'
                mv -fT -- "$temp" "$file"
                printf 'file\n%s\n' "$content"
                ;;
        esac
        exit 0
        ;;
esac

[ -f "$main" ] || fail "File not found: $main"
if [ "$module" = nginx ]; then
    if [ "$action" = validate ]; then
        for candidate in "$@"; do [ -f "$candidate" ] || fail "File not found: $candidate"; done
        exit 0
    fi
    nginx=${executable:-nginx}
    set -- -c "$main"
    if [ -n "$prefix" ]; then set -- "$@" -p "$prefix"; fi
    if [ "$action" = test ]; then exec "$nginx" "$@" -t 2>&1; fi
    "$nginx" "$@" -t 2>&1
    exec "$nginx" "$@" -s reload 2>&1
fi

[ "$(realpath -e -- "$main")" = "$main" ] || fail 'Use the actual JAR file and directory, without symbolic links.'
if [ "$action" = validate ]; then exit 0; fi
key=$(printf '%s' "$main" | digest)
state_dir="$HOME/.devkit-ssh/jar"
mkdir -p -- "$state_dir"
[ ! -L "$state_dir" ] || fail 'The JAR runtime directory is a link.'
record="$state_dir/$key.pid"
log="$state_dir/$key.log"
marker="-Ddevkit.ssh.jar=$key"
exec 9>"$state_dir/$key.lock"
lock

stamp() {
    IFS= read -r process_stat < "/proc/$1/stat" || return 1
    set -- ${process_stat##*) }
    [ "$#" -ge 20 ] && [ "$1" != Z ] && printf '%s' "${20}"
}
matches_command() {
    xargs -0 sh -c '
        jar=$1
        marker=$2
        shift 2
        expect_path=false
        matched_path=false
        matched_marker=false
        [ -n "$marker" ] || matched_marker=true
        for argument do
            if $expect_path && [ "$argument" = "$jar" ]; then matched_path=true; fi
            if [ "$argument" = "-jar" ]; then expect_path=true; else expect_path=false; fi
            if [ "$argument" = "$marker" ]; then matched_marker=true; fi
        done
        $matched_path && $matched_marker
    ' devkit "$main" "$2" 2>/dev/null < "$1"
}
identity() {
    [ "$(stamp "$pid" 2>/dev/null)" = "$created" ] &&
        matches_command "/proc/$pid/cmdline" "$marker"
}
status_jar() {
    pid= created=
    if [ -e "$record" ]; then
        regular "$record" || fail 'The PID record must be a regular file.'
        IFS=' ' read -r pid created < "$record" || fail 'Invalid PID record.'
        case "$pid:$created" in *[!0-9:]*|:*|*:) fail 'Invalid PID record.' ;; esac
        [ "$pid" -gt 1 ] || fail 'Invalid PID record.'
        if identity; then return 0; fi
        if [ "$(stamp "$pid" 2>/dev/null)" = "$created" ]; then fail 'Process identity cannot be verified.'; fi
    fi
    return 1
}
stop_jar() {
    if ! status_jar; then return 0; fi
    identity || fail 'Process identity changed before stop.'
    kill -TERM "$pid"
    tries=0
    while identity; do
        [ "$tries" -lt 15 ] || fail 'The process did not stop within 15 seconds.'
        sleep 1
        tries=$((tries + 1))
    done
    [ "$(stamp "$pid" 2>/dev/null)" != "$created" ] || fail 'Process identity cannot be verified.'
    rm -f -- "$record"
}
start_jar() {
    trap '' HUP
    if status_jar; then fail 'This JAR is already running.'; fi
    for cmdline in /proc/[0-9]*/cmdline; do
        if matches_command "$cmdline" ''; then
            fail 'A process using this JAR path already exists. Stop it from its original manager first.'
        fi
    done
    java=${executable:-${JAVA_HOME:+$JAVA_HOME/bin/java}}
    java=${java:-java}
    command -v "$java" >/dev/null || fail 'Java not found. Specify its absolute path.'
    cd -- "$directory"
    [ ! -e "$log" ] && [ ! -L "$log" ] || regular "$log" || fail 'The log must be a regular file.'
    nohup "$java" "$marker" -jar "$main" "$@" </dev/null >>"$log" 2>&1 9>&- &
    pid=$!
    sleep 1
    created=$(stamp "$pid" 2>/dev/null) || fail "Java exited during startup. See $log"
    identity || fail 'The Java process identity could not be verified.'
    temp=$(mktemp -- "$state_dir/.devkit-ssh.XXXXXXXX")
    trap 'rm -f -- "$temp"' EXIT
    printf '%s %s\n' "$pid" "$created" > "$temp"
    mv -fT -- "$temp" "$record"
    printf 'PID %s\n' "$pid"
}
case "$action" in
    status) if status_jar; then printf 'PID %s\n' "$pid"; else printf 'stopped\n'; fi ;;
    start) start_jar "$@" ;;
    stop) stop_jar; printf 'stopped\n' ;;
    restart) stop_jar; start_jar "$@" ;;
    log) if [ -e "$log" ]; then regular "$log" || fail 'The log must be a regular file.'; tail -c 131072 -- "$log"; fi ;;
esac

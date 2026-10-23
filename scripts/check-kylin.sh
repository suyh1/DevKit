#!/bin/sh
set -u
runtime=${1:-/opt/devkit}
failed=0
printf 'Architecture: %s\n' "$(dpkg --print-architecture)"
printf 'glibc: %s\n' "$(getconf GNU_LIBC_VERSION)"
if [ "$(dpkg --print-architecture)" != arm64 ]; then
  echo 'ERROR: this package requires ARM64.'
  failed=1
fi
if [ ! -f "$runtime/devkit" ]; then
  echo "ERROR: runtime not found under $runtime"
  exit 1
fi
for binary in "$runtime/devkit" "$runtime/chrome_crashpad_handler" "$runtime"/*.so; do
  [ -f "$binary" ] || continue
  result=$(ldd "$binary" 2>&1)
  if printf '%s\n' "$result" | grep -E 'not found|version .* not found' >/dev/null; then
    printf '\nERROR: %s\n%s\n' "$binary" "$result"
    failed=1
  fi
done
if [ ! -u "$runtime/chrome-sandbox" ]; then
  echo 'ERROR: Chromium sandbox helper is missing its packaged setuid permission. Reinstall the original deb; do not use --no-sandbox.'
  failed=1
fi
if [ "$failed" -eq 0 ]; then
  echo 'Base library checks passed. Next launch devkit as your normal desktop user.'
fi
exit "$failed"

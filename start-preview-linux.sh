#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

fail() {
  echo "" >&2
  echo "$1" >&2
  echo "DevKit preview could not start. See the message above." >&2
  exit 1
}

for candidate in \
  "$HOME/.volta/bin" \
  "$HOME/.asdf/shims" \
  "$HOME/.local/share/mise/shims" \
  "$HOME/.local/bin" \
  /usr/local/bin; do
  if [ -d "$candidate" ] && [[ ":$PATH:" != *":$candidate:"* ]]; then
    PATH="$candidate:$PATH"
  fi
done
if ! command -v node >/dev/null 2>&1 && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 || true
fi
export PATH

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)" >/dev/null 2>&1; then
  fail "Install Node.js 24 or newer and make sure it is available on PATH."
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "npm was not found on PATH. Check your Node.js installation."
fi

for tool in tar unzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool was not found on PATH. Install $tool and try again."
  fi
done

if ! node -e "require.resolve('vite'); require.resolve('typescript'); require('electron')" >/dev/null 2>&1; then
  echo "Installing project dependencies..."
  npm ci --include=dev || fail "Failed to install project dependencies."
fi

echo "Building DevKit from the current source..."
npm run desktop -- --preview || fail "DevKit preview exited with an error."

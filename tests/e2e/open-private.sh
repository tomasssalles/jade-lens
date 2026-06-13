#!/usr/bin/env bash
# Called by Vite (via BROWSER env var) to open $1 in a private/incognito window.
URL="$1"

if [[ "$OSTYPE" == "darwin"* ]]; then
    if open -Ra "Google Chrome" 2>/dev/null; then
        open -na "Google Chrome" --args --incognito --new-window "$URL"
    elif open -Ra "Firefox" 2>/dev/null; then
        open -a Firefox --args --private-window "$URL"
    else
        echo "open-private: no supported browser found; open manually: $URL" >&2
    fi
else
    if command -v google-chrome &>/dev/null; then
        google-chrome --incognito --new-window "$URL" &
    elif command -v chromium &>/dev/null; then
        chromium --incognito --new-window "$URL" &
    elif command -v firefox &>/dev/null; then
        firefox --private-window "$URL" &
    else
        echo "open-private: no supported browser found; open manually: $URL" >&2
    fi
fi

#!/usr/bin/env bash
# Renders the JADE LENS skill from the bundled template every session,
# installing `jadelens` first if it isn't already on PATH.
#
# Idempotent: if jadelens is already present (e.g. the developer's
# `uv tool install -e` editable install on desktop), the install step
# no-ops. If the rendered SKILL.md already exists, render-skill no-ops
# too. Delete the rendered skill to force a re-render.

DATA_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 1. Ensure jadelens is on PATH.
if ! command -v jadelens >/dev/null 2>&1; then
    uv tool install "git+https://github.com/tomasssalles/jade-lens.git@cli-latest" || {
        echo "session-start: failed to install jadelens; cannot render skill" >&2
        exit 1
    }
fi

# 2. Render the skill into <data-repo>/.claude/skills/<assistant.name>/SKILL.md.
jadelens render "$DATA_REPO" || {
    echo "session-start: 'jadelens render' failed" >&2
    exit 1
}

# 3. Symlink ~/.claude/skills/<assistant.name>/ → the rendered skill dir,
#    so /<name> works from any claude session. On claude.ai the symlink doesn't
#    persist; that's fine — the same dir is reachable via the project's
#    own .claude/skills/<name>/ at session start.
ASSISTANT_NAME=$(
    python3 -c "import json; print(json.load(open('$DATA_REPO/.jade/config.json'))['assistant']['name'])" \
        2>/dev/null
) || exit 0

HOME_SKILLS="$HOME/.claude/skills"
HOME_SKILL="$HOME_SKILLS/$ASSISTANT_NAME"
DATA_SKILL="$DATA_REPO/.claude/skills/$ASSISTANT_NAME"

# Already pointing at the right place? Silent no-op (the steady state).
if [ -L "$HOME_SKILL" ] && [ "$(readlink "$HOME_SKILL")" = "$DATA_SKILL" ]; then
    exit 0
fi

if [ -e "$HOME_SKILL" ] || [ -L "$HOME_SKILL" ]; then
    # Something else is there. Don't clobber; tell the user how to take over.
    echo "Note: $HOME_SKILL already exists but isn't pointing at this data repo."
    echo "If you'd like /$ASSISTANT_NAME (from any directory) to point here, inspect"
    echo "the existing path and then run:"
    echo "  rm -rf '$HOME_SKILL' && ln -s '$DATA_SKILL' '$HOME_SKILL'"
    exit 0
fi

# Path is empty. Try to create the parent dir + symlink in one shot.
if mkdir -p "$HOME_SKILLS" 2>/dev/null && ln -s "$DATA_SKILL" "$HOME_SKILL" 2>/dev/null; then
    echo "✓ Symlinked $HOME_SKILL → $DATA_SKILL"
    echo "  You can now use /$ASSISTANT_NAME from any Claude Code session, in any directory."
else
    echo "To enable /$ASSISTANT_NAME from any Claude Code session (not just inside this data repo), run:"
    echo "  mkdir -p '$HOME_SKILLS' && ln -s '$DATA_SKILL' '$HOME_SKILL'"
fi

#!/usr/bin/env bash
# Aggregate bug reports from one or more round artifact dirs into a single
# triage document for the host-side debug agent.
#
# Find-mode rounds (run-round.sh --mode find, the default) write structured
# bug reports into /home/azureuser/hapi-rounds/round-N/round-N.md under the
# `## Bugs Found` section. This script extracts those sections from each
# round and stitches them into BUGS-AGGREGATE.md so a separate fix agent can
# triage all findings in one place.
#
# Legacy fix-mode rounds wrote into a per-round git worktree at
# /home/azureuser/hapi-worktrees-round-N/docs/e2e_test/round-N.md. This
# script auto-detects either layout and prefers the find-mode artifact if
# both are present for the same round.
#
# Usage:
#   bash docker/triage-rounds.sh                    # auto-discover all rounds
#   bash docker/triage-rounds.sh 14 15 16 17        # explicit round list
#   bash docker/triage-rounds.sh -o bugs.md ...     # custom output path
#
# Default output is /tmp/BUGS-AGGREGATE.md so it doesn't accidentally land
# inside any round artifact dir or worktree.

set -euo pipefail

OUT="/tmp/BUGS-AGGREGATE.md"
ROUNDS=()

while [ $# -gt 0 ]; do
    case "$1" in
        -o|--output) OUT="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        [0-9]*) ROUNDS+=("$1"); shift ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

# For a given round number, return the canonical round-N.md path:
# prefer the find-mode artifact dir, fall back to the legacy worktree.
round_md_path() {
    local n="$1"
    local find_path="/home/azureuser/hapi-rounds/round-$n/round-$n.md"
    local fix_path="/home/azureuser/hapi-worktrees-round-$n/docs/e2e_test/round-$n.md"
    if [ -f "$find_path" ]; then
        echo "$find_path"
    elif [ -f "$fix_path" ]; then
        echo "$fix_path"
    else
        echo ""
    fi
}

# For a given round number, return the canonical screenshots dir:
round_shots_path() {
    local n="$1"
    local find_path="/home/azureuser/hapi-rounds/round-$n/round-$n-screenshots"
    local fix_path="/home/azureuser/hapi-worktrees-round-$n/docs/e2e_test/round-$n-screenshots"
    if [ -d "$find_path" ]; then
        echo "$find_path"
    elif [ -d "$fix_path" ]; then
        echo "$fix_path"
    else
        echo ""
    fi
}

# For a given round number, return human-friendly origin description:
round_origin() {
    local n="$1"
    if [ -d "/home/azureuser/hapi-rounds/round-$n" ]; then
        echo "find-mode artifact dir at /home/azureuser/hapi-rounds/round-$n"
    elif [ -d "/home/azureuser/hapi-worktrees-round-$n" ]; then
        echo "fix-mode worktree at /home/azureuser/hapi-worktrees-round-$n (branch e2e/round-$n)"
    else
        echo "(missing — neither find nor fix artifacts found)"
    fi
}

# Auto-discover if no rounds given. Look in both layouts.
if [ ${#ROUNDS[@]} -eq 0 ]; then
    for d in /home/azureuser/hapi-rounds/round-*/ /home/azureuser/hapi-worktrees-round-*/; do
        [ -d "$d" ] || continue
        n="${d%/}"
        n="${n##*-}"
        ROUNDS+=("$n")
    done
fi

if [ ${#ROUNDS[@]} -eq 0 ]; then
    echo "[triage] no round artifacts found and none specified" >&2
    exit 1
fi

# Numeric sort, dedupe.
mapfile -t ROUNDS < <(printf '%s\n' "${ROUNDS[@]}" | sort -nu)

{
    echo "# HAPI E2E Bug Triage Aggregate"
    echo
    echo "Generated: $(date '+%Y-%m-%d %H:%M %Z')"
    echo
    echo "Source rounds: ${ROUNDS[*]}"
    echo
    echo "## How to use this document"
    echo
    echo "Each section below is a verbatim extract of the \`## Bugs Found\`"
    echo "block from one round's \`round-N.md\`. Origins:"
    echo '```'
    for n in "${ROUNDS[@]}"; do
        printf "  R%-3s  %s\n" "$n" "$(round_origin "$n")"
    done
    echo '```'
    echo
    echo "**Triage workflow** (host fix agent):"
    echo
    echo "1. Read each \"Round N\" section below."
    echo "2. Group bugs by suspected root cause across rounds (e.g. R15-1 and"
    echo "   R17-2 may both point at the same hub handler)."
    echo "3. For each group, decide: fix / defer / not-a-bug / spec change."
    echo "4. For find-mode rounds: copy round-N.md + screenshots into the main"
    echo "   repo at \`docs/e2e_test/\`, write the fix on a fix branch, run"
    echo "   the round's Repro steps to verify, commit (test commit + fix"
    echo "   commits, fixes-then-test order to match R1-R17 history style)."
    echo "5. For fix-mode rounds: cherry-pick the round's existing commits"
    echo "   from its \`e2e/round-N\` branch."
    echo
    echo "---"

    for n in "${ROUNDS[@]}"; do
        FILE="$(round_md_path "$n")"
        echo
        echo "## Round $n"
        echo
        if [ -z "$FILE" ]; then
            echo "_⚠ no round-$n.md found — round may not have completed_"
            continue
        fi
        echo "Source file: \`$FILE\`"
        echo
        # Extract from "## Bugs Found" up to but not including the next "## " heading.
        BUGS_BLOCK="$(awk '
            /^## Bugs Found/ { capture = 1; print; next }
            capture && /^## / { capture = 0 }
            capture { print }
        ' "$FILE")"
        if [ -z "$BUGS_BLOCK" ]; then
            echo "_⚠ no \`## Bugs Found\` section in round-$n.md_"
            continue
        fi
        printf '%s\n' "$BUGS_BLOCK"
        # Surface the screenshot dir so the triage agent knows where to look.
        SHOTS="$(round_shots_path "$n")"
        if [ -n "$SHOTS" ]; then
            COUNT="$(find "$SHOTS" -maxdepth 1 -name '*.png' | wc -l)"
            echo
            echo "**Screenshots** ($COUNT files): \`$SHOTS\`"
        else
            echo
            echo "_(no screenshots dir)_"
        fi
    done
} > "$OUT"

echo "[triage] wrote aggregate → $OUT"
echo "[triage] $(wc -l < "$OUT") lines, $(wc -c < "$OUT") bytes"
echo
echo "Quick view: less $OUT"
echo "Open in editor: \$EDITOR $OUT"

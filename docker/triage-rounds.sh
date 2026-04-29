#!/usr/bin/env bash
# Aggregate bug reports from one or more round worktrees into a single
# triage document for the host-side debug agent.
#
# Round agents run in find-only mode (`run-round.sh --mode find`, the default)
# and write structured bug reports into `docs/e2e_test/round-N.md` under the
# `## Bugs Found` section. This script extracts those sections from each
# round and stitches them into BUGS-AGGREGATE.md so a separate fix agent can
# triage all findings in one place.
#
# Usage:
#   bash docker/triage-rounds.sh                    # auto-discover all round-* worktrees
#   bash docker/triage-rounds.sh 14 15 16 17        # explicit round list
#   bash docker/triage-rounds.sh -o bugs.md ...     # custom output path
#
# The output is plain markdown. Default location is /tmp/BUGS-AGGREGATE.md so
# it doesn't accidentally land inside any round worktree.

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

# Auto-discover if no rounds given.
if [ ${#ROUNDS[@]} -eq 0 ]; then
    for d in /home/azureuser/hapi-worktrees-round-*/; do
        [ -d "$d" ] || continue
        n="${d%/}"
        n="${n##*-}"
        ROUNDS+=("$n")
    done
fi

if [ ${#ROUNDS[@]} -eq 0 ]; then
    echo "[triage] no round worktrees found and none specified" >&2
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
    echo "block from one round's \`docs/e2e_test/round-N.md\`. Branches and"
    echo "screenshots stay on each round's worktree:"
    echo '```'
    for n in "${ROUNDS[@]}"; do
        echo "  R$n  →  /home/azureuser/hapi-worktrees-round-$n  (branch e2e/round-$n)"
    done
    echo '```'
    echo
    echo "**Triage workflow** (host agent):"
    echo
    echo "1. Read each \"Round N\" section below."
    echo "2. Group bugs by suspected root cause across rounds (e.g. R15-1 and"
    echo "   R17-2 may both point at the same hub handler)."
    echo "3. For each group, decide: fix / defer / not-a-bug / spec change."
    echo "4. For fixes: cherry-pick the round's test commit onto a fix branch,"
    echo "   write the fix, run the round's repro steps to verify, commit."
    echo "5. Update each round's \`Bugs Found\` table to point at the fix"
    echo "   commit (post-triage annotation)."
    echo
    echo "---"

    for n in "${ROUNDS[@]}"; do
        FILE="/home/azureuser/hapi-worktrees-round-$n/docs/e2e_test/round-$n.md"
        echo
        echo "## Round $n"
        echo
        if [ ! -f "$FILE" ]; then
            echo "_⚠ \`$FILE\` not found — round may not have completed_"
            continue
        fi
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
        SHOTS="/home/azureuser/hapi-worktrees-round-$n/docs/e2e_test/round-$n-screenshots"
        if [ -d "$SHOTS" ]; then
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

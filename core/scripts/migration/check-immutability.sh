#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
if [[ -d "$repo_root/core/crates/openh3-db/migrations" ]]; then
    repo_root="$repo_root/core"
fi
cd "$repo_root"

duplicate_versions="$(
    find crates/openh3-db/migrations -maxdepth 1 -type f -name '*.sql' -print \
        | awk -F/ '
            {
                name = $NF
                if (name ~ /^[0-9]+_/) {
                    version = name
                    sub(/_.*/, "", version)
                    version += 0
                    count[version]++
                    files[version] = files[version] (files[version] == "" ? "" : ", ") name
                }
            }
            END {
                for (version in count) {
                    if (count[version] > 1) {
                        print version ": " files[version]
                    }
                }
            }
        ' \
        | sort
)"

if [[ -n "$duplicate_versions" ]]; then
    cat >&2 <<'EOF'
Duplicate database migration versions are not allowed.

Rename the later migration to the next unused numeric prefix.

Duplicate versions:
EOF
    echo "$duplicate_versions" >&2
    exit 1
fi

if [[ "${AIONCORE_ALLOW_MAIN_MIGRATION_EDIT:-}" == "1" ]]; then
    echo "AIONCORE_ALLOW_MAIN_MIGRATION_EDIT=1; skipping migration immutability check"
    exit 0
fi

base_ref="${AIONCORE_MIGRATION_BASE_REF:-}"
if [[ -z "$base_ref" ]]; then
    if git rev-parse --verify --quiet origin/main >/dev/null; then
        base_ref="origin/main"
    elif git rev-parse --verify --quiet main >/dev/null; then
        base_ref="main"
    else
        echo "No origin/main or main ref found; skipping migration immutability check"
        exit 0
    fi
fi

if ! git rev-parse --verify --quiet "$base_ref" >/dev/null; then
    echo "Migration immutability base ref not found: $base_ref" >&2
    exit 1
fi

base_commit="$(git merge-base HEAD "$base_ref")"
changed="$(
    git diff --name-status --find-renames --diff-filter=DMR "$base_commit" -- \
        'crates/openh3-db/migrations/*.sql' 'crates/aionui-db/migrations/*.sql' | \
        awk '$1 != "R100"'
)"

if [[ -n "$changed" ]]; then
    cat >&2 <<'EOF'
Existing migration files from main must not be modified or deleted.

Fix this by reverting changes to existing migration files and adding a new next-numbered migration instead.
If this is an intentional high-risk exception, rerun with AIONCORE_ALLOW_MAIN_MIGRATION_EDIT=1.

Changed existing migrations:
EOF
    echo "$changed" >&2
    exit 1
fi

echo "Migration immutability check passed"

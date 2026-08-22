#!/usr/bin/env bash
# Point git at the repo's tracked hooks. Run once per clone.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/*
echo "hooks installed: $(git config core.hooksPath)"

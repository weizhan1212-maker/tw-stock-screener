#!/usr/bin/env bash
# 把 run.log 存到 run-logs 分支（logs/<run_id>-<job>.log），方便事後查看
set -u
NAME="${1:-run}"
[ -f run.log ] || { echo "沒有 run.log"; exit 0; }
LOG=$(mktemp); cp run.log "$LOG"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git stash -u -q 2>/dev/null || true
if git ls-remote --exit-code origin run-logs >/dev/null 2>&1; then
  git fetch -q --depth 1 origin run-logs && git checkout -q -B run-logs FETCH_HEAD
else
  git checkout -q --orphan run-logs && git rm -rqf --cached . && git clean -fdqx
fi
mkdir -p logs && cp "$LOG" "logs/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${NAME}.log"
git add logs && git commit -qm "log ${GITHUB_RUN_ID} ${NAME}" && \
  for i in 1 2 3; do git push -q origin run-logs && break; git fetch -q --depth 1 origin run-logs && git rebase -q FETCH_HEAD; sleep 3; done

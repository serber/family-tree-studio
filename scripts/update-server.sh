#!/usr/bin/env bash
# Deploys a new version on the server from a source tarball on stdin.
#
#   git archive main | ssh root@<server> 'bash /opt/tree-studio/scripts/update-server.sh'
#
# Replaces the sources in /opt/tree-studio (keeping node_modules and the builds),
# installs dependencies, typechecks, builds into dist-next and swaps it in, keeping
# the previous build as dist-prev. nginx serves dist/ and needs no reload.
# Rollback: cd /opt/tree-studio && mv dist dist-bad && mv dist-prev dist
#
# The body is one function so bash has read the whole file before the rsync below
# replaces it with the new version.
set -euo pipefail

main() {
  local app=/opt/tree-studio
  local incoming
  incoming=$(mktemp -d)
  # mktemp makes the directory 0700 and rsync -a would copy that onto $app, locking nginx out.
  chmod 755 "$incoming"
  trap "rm -rf '$incoming'" EXIT
  tar -x -C "$incoming"
  cd "$app"
  rsync -a --delete --exclude node_modules --exclude dist --exclude dist-prev --exclude dist-next --exclude REVISION "$incoming"/ ./

  # The server also runs other services: build gently and cap Node's heap.
  export NODE_OPTIONS=--max-old-space-size=768
  nice -n 10 npm ci --no-audit --no-fund
  nice -n 10 npm run typecheck
  rm -rf dist-next
  nice -n 10 npx vite build --outDir dist-next --logLevel warn

  rm -rf dist-prev
  if [ -d dist ]; then mv dist dist-prev; fi
  mv dist-next dist
  date -u +"%Y-%m-%dT%H:%M:%SZ" > REVISION
  echo "Deployed to $app/dist. Previous build: dist-prev (rollback: mv dist dist-bad && mv dist-prev dist)."
}

main "$@"
exit

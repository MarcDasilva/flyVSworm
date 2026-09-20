#!/bin/sh
# Container entrypoint. The thru CLI reads its RPC and signing keys from ~/.thru/cli/config.yaml;
# it arrives as ONE base64 secret so the file is byte-identical to the one that works locally —
#   fly secrets set THRU_CONFIG_B64="$(base64 < ~/.thru/cli/config.yaml)"
set -e
mkdir -p ~/.thru/cli
printf '%s' "$THRU_CONFIG_B64" | base64 -d > ~/.thru/cli/config.yaml
cd /app/fly-brain/python && python3 server.py --host 0.0.0.0 --port 8000 &
cd /app/wormed/web && exec node relay.mjs

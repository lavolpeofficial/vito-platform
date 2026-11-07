#!/usr/bin/env bash
# VITO ONE COCKPIT A8 · READ-ONLY FSN1 release capacity preflight.
# No secrets, database access, file mutation, Docker restart or deployment.
set -Eeuo pipefail
set +x
blocked=0
check() {
 if [[ "$2" == "true" ]]; then
  printf 'PASS %s\n' "$1"
 else
  printf 'BLOCKED %s\n' "$1"
  blocked=1
 fi
}
check HOST_IS_FSN1 "$([[ "$(hostname -s)" == ubuntu-4gb-fsn1-1 ]] && echo true || echo false)"
disk=$(df -Pk / | awk 'NR == 2 {print $4}')
mem=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
swap_total=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)
swap_free=$(awk '/^SwapFree:/{print $2}' /proc/meminfo)
check ROOT_DISK_4G_FREE "$((disk >= 4*1024*1024))"
check MEMORY_900_MIB_AVAILABLE "$((mem >= 900*1024))"
check SWAP_128_MIB_FREE "$((swap_total == 0 || swap_free >= 128*1024))"
for container in vito-r376-ui-live vito-r369-api-live; do
 running=$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo false)
 check "BASELINE_RUNNING_$container" "$running"
done
api=$(docker inspect vito-r369-api-live --format '{{range .Mounts}}{{if eq .Destination "/app/apps/api/dist"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)
ui=$(docker inspect vito-r376-ui-live --format '{{range .Mounts}}{{if eq .Destination "/app/apps/control-center/.next"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)
check EXISTING_API_BIND_MOUNT "$([[ -n "$api" && -d "$api" ]] && echo true || echo false)"
check EXISTING_UI_BIND_MOUNT "$([[ -n "$ui" && -d "$ui" ]] && echo true || echo false)"
http=$(curl -LsS -o /dev/null --max-time 12 -w '%{http_code}:%{ssl_verify_result}' https://vito.la-volpe.it/login || true)
check BASELINE_LOGIN_HTTP_TLS "$([[ "$http" == "200:0" ]] && echo true || echo false)"
printf 'DISK_FREE_MIB=%s\n' "$((disk/1024))"
printf 'MEM_AVAILABLE_MIB=%s\n' "$((mem/1024))"
printf 'SWAP_FREE_MIB=%s\n' "$((swap_free/1024))"
if (( blocked )); then
 echo 'A8_PREFLIGHT=BLOCKED_NO_DEPLOY'
 exit 75
fi
echo 'A8_PREFLIGHT=CAPACITY_PASS_NOT_DEPLOY_AUTHORIZATION'

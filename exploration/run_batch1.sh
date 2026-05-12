#!/usr/bin/env bash
# Batch 1 — Fills curl runner. Writes raw JSON samples + a TSV log.
set -u
API_KEY="REDACTED_API_KEY"
BASE="https://api.hypedexer.com"
OUT="/home/yaugourt/hypedexer-sdk/exploration/samples/batch-1"
LOG="$OUT/_calls.tsv"
mkdir -p "$OUT"
: > "$LOG"

call() {
  local name="$1"; shift
  local url="$1"; shift
  local extra_header="${1:-}"; shift || true
  local out="$OUT/${name}.json"
  local meta
  if [ -n "$extra_header" ]; then
    meta=$(curl -sS -o "$out" -w "%{http_code}\t%{time_total}" -H "X-API-Key: $API_KEY" -H "$extra_header" "$url")
  else
    meta=$(curl -sS -o "$out" -w "%{http_code}\t%{time_total}" -H "X-API-Key: $API_KEY" "$url")
  fi
  printf "%s\t%s\t%s\n" "$name" "$meta" "$url" | tee -a "$LOG"
  sleep 0.3
}

# Pre-flight: get a real user from /fills/recent
call "_seed-recent" "$BASE/fills/recent?limit=5"
REAL_USER=$(python3 -c "
import json,sys
try:
    d=json.load(open('$OUT/_seed-recent.json'))
    data=d.get('data') or []
    if isinstance(data,dict): data=data.get('fills') or data.get('items') or []
    for f in data:
        u=f.get('user') or f.get('user_address')
        if u: print(u); break
except Exception as e:
    pass
")
if [ -z "$REAL_USER" ]; then REAL_USER="0x0000000000000000000000000000000000000000"; fi
echo "REAL_USER=$REAL_USER" | tee -a "$LOG"

# Time window: last 1h (ISO UTC)
START=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

############ /fills/
call "fills-baseline"            "$BASE/fills/?limit=5"
call "fills-filter-coin-btc"     "$BASE/fills/?limit=5&coin=BTC"
call "fills-filter-side-b"       "$BASE/fills/?limit=5&side=B"
call "fills-filter-prio-gas"     "$BASE/fills/?limit=5&has_priority_gas=true"
call "fills-page1"               "$BASE/fills/?limit=5"
CURSOR=$(python3 -c "import json; d=json.load(open('$OUT/fills-page1.json')); print(d.get('next_cursor') or '')")
echo "fills cursor=$CURSOR" | tee -a "$LOG"
if [ -n "$CURSOR" ]; then
  call "fills-page2"             "$BASE/fills/?limit=5&cursor=$CURSOR"
fi
call "fills-timewindow"          "$BASE/fills/?limit=5&start_time=${START}&end_time=${END}"
call "fills-bad-coin"            "$BASE/fills/?limit=5&coin=DOESNOTEXIST"
call "fills-bad-limit"           "$BASE/fills/?limit=99999"

############ /fills/recent
call "recent-baseline"           "$BASE/fills/recent?limit=5"
call "recent-filter-coin-eth"    "$BASE/fills/recent?limit=5&coin=ETH"
call "recent-filter-side-a"      "$BASE/fills/recent?limit=5&side=A"
call "recent-page1"              "$BASE/fills/recent?limit=5"
RCURSOR=$(python3 -c "import json; d=json.load(open('$OUT/recent-page1.json')); print(d.get('next_cursor') or '')")
echo "recent cursor=$RCURSOR" | tee -a "$LOG"
if [ -n "$RCURSOR" ]; then
  call "recent-page2"            "$BASE/fills/recent?limit=5&cursor=$RCURSOR"
fi
call "recent-timewindow"         "$BASE/fills/recent?limit=5&start_time=${START}&end_time=${END}"
call "recent-bad-coin"           "$BASE/fills/recent?limit=5&coin=DOESNOTEXIST"

############ /fills/user/{addr}
call "user-baseline"             "$BASE/fills/user/${REAL_USER}?limit=5"
call "user-filter-coin"          "$BASE/fills/user/${REAL_USER}?limit=5&coin=BTC"
call "user-page1"                "$BASE/fills/user/${REAL_USER}?limit=5"
UCURSOR=$(python3 -c "import json; d=json.load(open('$OUT/user-page1.json')); print(d.get('next_cursor') or '')")
echo "user cursor=$UCURSOR" | tee -a "$LOG"
if [ -n "$UCURSOR" ]; then
  call "user-page2"              "$BASE/fills/user/${REAL_USER}?limit=5&cursor=$UCURSOR"
fi
call "user-timerange-24h"        "$BASE/fills/user/${REAL_USER}?limit=5&time_range=24h"
call "user-timewindow"           "$BASE/fills/user/${REAL_USER}?limit=5&start_time=${START}&end_time=${END}"
call "user-bad-addr"             "$BASE/fills/user/0x123?limit=5"
call "user-bad-limit"            "$BASE/fills/user/${REAL_USER}?limit=99999"

############ /fills/count
call "count"                     "$BASE/fills/count"

############ /fills/spot/
call "spot-baseline"             "$BASE/fills/spot/?limit=5"
call "spot-filter-coin-purr"     "$BASE/fills/spot/?limit=5&coin=PURR"
call "spot-filter-side-b"        "$BASE/fills/spot/?limit=5&side=B"
call "spot-timewindow"           "$BASE/fills/spot/?limit=5&start_time=${START}&end_time=${END}"
call "spot-bad-coin"             "$BASE/fills/spot/?limit=5&coin=DOESNOTEXIST"

# spot uses offset-based pagination per swagger
call "spot-page1"                "$BASE/fills/spot/?limit=5&offset=0"
call "spot-page2"                "$BASE/fills/spot/?limit=5&offset=5"

############ /fills/spot/user/{addr}
# Try to find a spot user
SPOT_USER=$(python3 -c "
import json
try:
    d=json.load(open('$OUT/spot-baseline.json'))
    data=d.get('data') or []
    if isinstance(data,dict): data=data.get('fills') or data.get('items') or []
    for f in data:
        u=f.get('user') or f.get('user_address')
        if u: print(u); break
except: pass
")
if [ -z "$SPOT_USER" ]; then SPOT_USER="$REAL_USER"; fi
echo "SPOT_USER=$SPOT_USER" | tee -a "$LOG"
call "spot-user-baseline"        "$BASE/fills/spot/user/${SPOT_USER}?limit=5"
call "spot-user-page2"           "$BASE/fills/spot/user/${SPOT_USER}?limit=5&offset=5"
call "spot-user-bad-addr"        "$BASE/fills/spot/user/0x123?limit=5"

############ Auth edge cases (use a separate header path)
echo "--- auth edge cases ---" | tee -a "$LOG"
meta=$(curl -sS -o "$OUT/_auth-missing.json" -w "%{http_code}\t%{time_total}" "$BASE/fills/?limit=1")
printf "%s\t%s\t%s\n" "_auth-missing" "$meta" "$BASE/fills/?limit=1" | tee -a "$LOG"
meta=$(curl -sS -o "$OUT/_auth-wrong.json" -w "%{http_code}\t%{time_total}" -H "X-API-Key: hl_live_bogus" "$BASE/fills/?limit=1")
printf "%s\t%s\t%s\n" "_auth-wrong" "$meta" "$BASE/fills/?limit=1" | tee -a "$LOG"

echo "DONE"

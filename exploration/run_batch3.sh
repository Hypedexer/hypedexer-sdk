#!/usr/bin/env bash
set -u
BASE="https://api.hypedexer.com"
KEY="REDACTED_API_KEY"
OUT="/home/yaugourt/hypedexer-sdk/exploration/samples/batch-3"
LOG="$OUT/_calls.tsv"
mkdir -p "$OUT"
: > "$LOG"
echo -e "name\tstatus\ttime_s\turl" > "$LOG"

call() {
  local name="$1" path="$2"
  local url="$BASE$path"
  local resp
  resp=$(curl -sS -o "$OUT/$name.json" -w "%{http_code}\t%{time_total}" -H "X-API-Key: $KEY" "$url")
  echo -e "$name\t$resp\t$url" | tee -a "$LOG"
  sleep 0.3
}

USER="0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00"
USER2="0xf5d81a135f756ca16544e53c20fc20643ec3ad53"

# 1. users/{user}/overview
call "user-overview-baseline" "/users/$USER/overview"
call "user-overview-timewindow" "/users/$USER/overview?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z"
call "user-overview-bad-addr" "/users/0x123/overview"

# 2. users/{user}/performance
call "user-performance-baseline" "/users/$USER/performance"
call "user-performance-timewindow" "/users/$USER/performance?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z"

# 3. users/{user}/coins
call "user-coins-baseline" "/users/$USER/coins?limit=10"
call "user-coins-timewindow" "/users/$USER/coins?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z&limit=10"
call "user-coins-bad-limit" "/users/$USER/coins?limit=999"

# 4. users/leaderboard
call "leaderboard-volume" "/users/leaderboard?by=volume&hours=24&limit=5"
call "leaderboard-pnl" "/users/leaderboard?by=pnl&hours=24&limit=5"
call "leaderboard-trades" "/users/leaderboard?by=trades&hours=24&limit=5"
call "leaderboard-priority-fees" "/users/leaderboard?by=priority_fees&hours=24&limit=5"
call "leaderboard-bogus-by" "/users/leaderboard?by=bogus&hours=24&limit=5"
call "leaderboard-bad-hours" "/users/leaderboard?by=volume&hours=999&limit=5"
call "leaderboard-bad-limit" "/users/leaderboard?by=volume&hours=24&limit=99999"

# 5. users/active
call "active-baseline" "/users/active?hours=1&limit=5"
call "active-24h" "/users/active?hours=24&limit=10"

# 6. completed-trades/
call "ct-baseline" "/completed-trades/?limit=5"
call "ct-filter-user" "/completed-trades/?user=$USER&limit=5"
call "ct-filter-coin-btc" "/completed-trades/?coin=BTC&limit=5"
call "ct-filter-direction-long" "/completed-trades/?direction=long&limit=5"
call "ct-filter-pnl" "/completed-trades/?min_pnl=100&max_pnl=10000&limit=5"
call "ct-page1" "/completed-trades/?limit=3&offset=0"
call "ct-page2" "/completed-trades/?limit=3&offset=3"
call "ct-with-count" "/completed-trades/?limit=3&do_count=true"
call "ct-sort-pnl-desc" "/completed-trades/?limit=5&sort_by=pnl&sort_dir=desc"
call "ct-sort-bogus" "/completed-trades/?limit=5&sort_by=bogus&sort_dir=desc"
call "ct-timewindow" "/completed-trades/?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z&limit=5"
call "ct-bad-coin" "/completed-trades/?coin=DOESNOTEXIST&limit=5"
call "ct-bad-limit" "/completed-trades/?limit=99999"

# 7. completed-trades/summary
call "ct-summary-baseline" "/completed-trades/summary"
call "ct-summary-user" "/completed-trades/summary?user=$USER"
call "ct-summary-coin-btc" "/completed-trades/summary?coin=BTC"
call "ct-summary-direction-short" "/completed-trades/summary?direction=short"
call "ct-summary-timewindow" "/completed-trades/summary?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z"

# 9. liquidations/
call "liq-baseline" "/liquidations/?limit=5"
call "liq-filter-coin-btc" "/liquidations/?coin=BTC&limit=5"
call "liq-filter-user" "/liquidations/?user=$USER&limit=5"
call "liq-filter-amount" "/liquidations/?amount_dollars=10000&limit=5"
call "liq-order-asc" "/liquidations/?order=asc&limit=5"
call "liq-order-desc" "/liquidations/?order=desc&limit=5"
call "liq-page1" "/liquidations/?limit=3"
call "liq-timewindow" "/liquidations/?start_time=2026-05-10T00:00:00Z&end_time=2026-05-11T00:00:00Z&limit=5"
call "liq-bad-coin" "/liquidations/?coin=DOESNOTEXIST&limit=5"
call "liq-bad-limit" "/liquidations/?limit=99999"
call "liq-bogus-order" "/liquidations/?order=bogus&limit=5"

# 10. liquidations/recent
call "liq-recent-baseline" "/liquidations/recent?limit=5"
call "liq-recent-coin-btc" "/liquidations/recent?coin=BTC&limit=5"

echo "DONE"

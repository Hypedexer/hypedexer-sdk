#!/bin/bash
API=REDACTED_API_KEY
BASE=https://api.hypedexer.com
cd /home/yaugourt/hypedexer-sdk/exploration/samples/batch-9

post() {
  local n=$1; local body=$2
  echo "=== $n ==="
  curl -s --max-time 15 -w "\nHTTP:%{http_code} T:%{time_total}\n" \
    -X POST -H "X-API-Key: $API" -H "Content-Type: application/json" \
    -d "$body" "$BASE/info" -o "info-$n.json"
  head -c 500 "info-$n.json"
  echo
  sleep 0.3
}

post fills '{"type":"fills","market":"perp","limit":2}'
post recentFills '{"type":"recentFills","market":"perp","limit":2}'
post fillsSummary '{"type":"fillsSummary","market":"perp"}'
post tradeHistory '{"type":"tradeHistory","limit":2}'
post accountOverview '{"type":"accountOverview","user":"0x0000000000000000000000000000000000000000"}'
post fillAnalytics '{"type":"fillAnalytics"}'
post bestTraders24h '{"type":"bestTraders24h","limit":2}'
post volume24h '{"type":"volume24h"}'
post liqHistory '{"type":"liqHistory","limit":2}'
post twapList '{"type":"twapList","limit":2}'
post topBuilders '{"type":"topBuilders","limit":2}'
post hip3Summary '{"type":"hip3Summary"}'
post hip3DexList '{"type":"hip3DexList"}'
post hip3Snapshots '{"type":"hip3Snapshots","limit":2}'
post spotTokenList '{"type":"spotTokenList"}'
post spotPairList '{"type":"spotPairList"}'
post currentFundingRates '{"type":"currentFundingRates"}'
post vaultList '{"type":"vaultList","limit":2}'
post gossipLiveStatus '{"type":"gossipLiveStatus"}'
post bogusType '{"type":"notARealType"}'
post missingRequired '{"type":"fillsByTradeId"}'
post emptyBody '{}'
post invalidJson 'notjson'
echo "DONE"

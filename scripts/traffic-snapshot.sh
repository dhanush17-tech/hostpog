#!/usr/bin/env bash
# Merges GitHub's last-14-days traffic into CSV files that keep the full history.
#   views.csv / clones.csv   date,count,uniques   (newest numbers win for a date)
#   stars.csv                date,stars,forks,watchers
#   referrers.csv / paths.csv  date,name,count,uniques  (one block per day)
# Usage: GH_TOKEN=... REPO=owner/name scripts/traffic-snapshot.sh <out-dir>
set -euo pipefail
out=${1:?output directory}
: "${REPO:?REPO=owner/name}"
mkdir -p "$out"
today=$(date -u +%F)
api() { gh api -H "Accept: application/vnd.github+json" "repos/$REPO/$1"; }

merge_daily() { # $1 file, $2 json key (views|clones), stdin: API json
  local file=$out/$1.csv new
  new=$(jq -r --arg k "$2" '.[$k][] | "\(.timestamp[0:10]),\(.count),\(.uniques)"')
  {
    echo "date,count,uniques"
    { [ -f "$file" ] && tail -n +2 "$file"; echo "$new"; } | awk -F, 'NF==3 { row[$1]=$0 } END { for (d in row) print row[d] }' | sort
  } >"$file.tmp" && mv "$file.tmp" "$file"
}

api traffic/views | merge_daily views views
api traffic/clones | merge_daily clones clones

append_today() { # $1 file, stdin: lines "name,count,uniques"
  local file=$out/$1.csv
  [ -f "$file" ] || echo "date,name,count,uniques" >"$file"
  grep -v "^$today," "$file" >"$file.tmp" || true
  sed "s/^/$today,/" >>"$file.tmp"
  mv "$file.tmp" "$file"
}
api traffic/popular/referrers | jq -r '.[] | "\(.referrer | gsub(","; " ")),\(.count),\(.uniques)"' | append_today referrers
api traffic/popular/paths | jq -r '.[] | "\(.path | gsub(","; " ")),\(.count),\(.uniques)"' | append_today paths

file=$out/stars.csv
[ -f "$file" ] || echo "date,stars,forks,watchers" >"$file"
grep -v "^$today," "$file" >"$file.tmp" || true
gh api "repos/$REPO" | jq -r --arg d "$today" '"\($d),\(.stargazers_count),\(.forks_count),\(.subscribers_count)"' >>"$file.tmp"
mv "$file.tmp" "$file"

echo "saved traffic for $REPO to $out"

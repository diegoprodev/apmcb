#!/usr/bin/env bash
set -euo pipefail

REALIP_CONF="${1:-infra/nginx/cloudflare-realip.conf}"

if [[ ! -r "$REALIP_CONF" ]]; then
  echo "FAIL: real-IP manifest is not readable: $REALIP_CONF" >&2
  exit 1
fi

mapfile -t CLOUDFLARE_CIDRS < <(
  awk '$1 == "set_real_ip_from" { value=$2; sub(/;$/, "", value); print value }' "$REALIP_CONF"
)

if [[ "${#CLOUDFLARE_CIDRS[@]}" -ne 22 ]]; then
  echo "FAIL: expected 22 Cloudflare CIDRs, found ${#CLOUDFLARE_CIDRS[@]}" >&2
  exit 1
fi

if [[ -n "${UFW_STATUS_FILE:-}" ]]; then
  UFW_STATUS="$(<"$UFW_STATUS_FILE")"
else
  if ! command -v ufw >/dev/null 2>&1; then
    echo "FAIL: ufw is unavailable" >&2
    exit 1
  fi
  UFW_STATUS="$(ufw status verbose)"
fi

if ! grep -q '^Status: active$' <<<"$UFW_STATUS"; then
  echo "FAIL: UFW is not active" >&2
  exit 1
fi

if ! grep -Eq '^Default: (deny|reject) \(incoming\),' <<<"$UFW_STATUS"; then
  echo "FAIL: UFW default incoming policy is not deny/reject" >&2
  exit 1
fi

has_allow_rule() {
  local port="$1"
  local cidr="$2"
  awk -v target_port="${port}/tcp" -v target_cidr="$cidr" '
    $1 == target_port {
      field=2
      if ($field == "(v6)") field++
      if ($field != "ALLOW") next
      field++
      if ($field == "IN") field++
      if ($field == target_cidr) found=1
    }
    END { exit !found }
  ' \
    <<<"$UFW_STATUS"
}

FAILURES=0
for cidr in "${CLOUDFLARE_CIDRS[@]}"; do
  for port in 80 443; do
    if ! has_allow_rule "$port" "$cidr"; then
      echo "FAIL: missing ${port}/tcp allow from ${cidr}" >&2
      FAILURES=$((FAILURES + 1))
    fi
  done
done

if ! BROAD_WEB_ALLOW="$(awk '
  {
    count=0
    delete token
    for (field=1; field<=NF; field++) {
      if ($field != "(v6)") token[++count]=$field
    }

    allow=0
    for (field=1; field<=count; field++) {
      if (token[field] == "ALLOW") {
        allow=field
        break
      }
    }
    if (!allow) next

    source_field=allow+1
    if (token[source_field] == "IN") source_field++
    source=token[source_field]
    if (source != "Anywhere" && source != "0.0.0.0/0" && source != "::/0") next

    destination=""
    for (field=1; field<allow; field++) {
      destination=destination (destination == "" ? "" : " ") token[field]
    }

    port_list=destination
    gsub(/\/tcp/, "", port_list)
    port_count=split(port_list, ports, ",")
    exposes_web_port=0
    for (field=1; field<=port_count; field++) {
      if (ports[field] == "80" || ports[field] == "443") exposes_web_port=1
    }

    if (destination == "Anywhere" || destination == "Nginx Full" || destination == "Nginx HTTP" || destination == "Nginx HTTPS" || exposes_web_port) {
      found=1
    }
  }
  END { print found ? "yes" : "no" }
' \
  <<<"$UFW_STATUS")"; then
  echo "FAIL: could not parse UFW rules" >&2
  exit 1
fi

if [[ "$BROAD_WEB_ALLOW" == "yes" ]]; then
  echo "FAIL: broad public allow still exists on TCP 80 or 443" >&2
  FAILURES=$((FAILURES + 1))
fi

if ! awk '
  $1 == "22/tcp" {
    field=2
    if ($field == "(v6)") field++
    if ($field == "ALLOW" || $field == "LIMIT") found=1
  }
  END { exit !found }
' \
  <<<"$UFW_STATUS"; then
  echo "FAIL: no preserved SSH allow/limit rule found" >&2
  FAILURES=$((FAILURES + 1))
fi

if [[ "$FAILURES" -ne 0 ]]; then
  echo "RESULT: FAIL (${FAILURES} firewall invariant violations)" >&2
  exit 1
fi

echo "RESULT: PASS (22 Cloudflare CIDRs x TCP 80/443, no broad web allow, SSH preserved)"

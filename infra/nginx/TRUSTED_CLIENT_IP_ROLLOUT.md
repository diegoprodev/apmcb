# Trusted client IP rollout

Scope: `api.apmcb.pmpb.online`, behind Cloudflare, with Nginx as the only
public reverse proxy and the BFF bound to loopback.

## Preconditions

- Keep one SSH session open throughout the firewall change.
- Confirm the BFF is healthy on `127.0.0.1` and through the public hostname.
- Confirm the Cloudflare IPv4/IPv6 lists still match
  `cloudflare-realip.conf`.
- Confirm the DNS record is proxied and TLS mode accepts the origin
  certificate.
- Save dated copies of the active Nginx site, real-IP config and UFW status.

## Safe order

1. Install `cloudflare-realip.conf` under `/etc/nginx/conf.d/`.
2. Update the active `/etc/nginx/sites-enabled/apmcb` file from
   `api.apmcb.pmpb.online.conf`. On the current VPS this is a regular file,
   not a symlink to the stale `sites-available/apmcb`; back up and restore the
   enabled file explicitly.
3. Run `nginx -t`, then inspect `nginx -T` and require the effective output to
   contain all 22 `set_real_ip_from` directives, `real_ip_header
   CF-Connecting-IP`, `real_ip_recursive on`, and both normalized
   `X-Real-IP`/`X-Forwarded-For` proxy headers. Reload Nginx only after this
   effective-config gate passes.
4. Enable the Cloudflare proxy for the API DNS record and require a `CF-Ray`
   response on the public hostname.
5. Before changing UFW, obtain the caller address from Cloudflare's trace
   endpoint, issue an identifiable `/health` probe and require the matching
   Nginx access-log line to show that caller address as `$remote_addr`, not a
   Cloudflare edge address. Repeat with a forged `X-Forwarded-For` and require
   the same normalized address. This detects a missing real-IP include or a
   Cloudflare transform that removed `CF-Connecting-IP`.
6. Add explicit UFW allow rules for TCP 80 and 443 from every CIDR in
   `cloudflare-realip.conf`.
7. Remove only the broad public TCP 80/443 rules. Do not alter SSH rules.
   Immediately execute
   `bash infra/scripts/check-cloudflare-origin-firewall.sh
   infra/nginx/cloudflare-realip.conf`; it must prove default incoming
   deny/reject, all 22 CIDRs on both ports, absence of broad web allows and a
   preserved SSH rule. If it fails, run the rollback first step immediately.
8. Prove that the public hostname remains healthy and direct origin access to
   TCP 443 is blocked.
9. Run `certbot renew --dry-run`; HTTP-01 must traverse the proxied hostname
   and reach the origin from a Cloudflare address.

## Rollback

If any smoke fails:

1. Re-add broad TCP 80/443 UFW allows before changing any other component.
2. Restore the dated Nginx files.
3. Run `nginx -t` and reload.
4. Disable proxying for the API DNS record only after the origin is reachable.
5. Re-run direct and hostname health checks and preserve the failed rollout
   artifacts for diagnosis.

The Cloudflare-specific UFW allow rules may remain during rollback; they are
strict subsets of the restored broad rules and are safe to remove later.

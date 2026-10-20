# SECURITY_AUDIT_2026-10-14 implementation status

| Finding | Status | Evidence / remaining work |
|---|---|---|
| C-01 | Fixed in source | Boarding credentials and JWT secret have no operational fallback; startup validates them. Rotate deployed values and sessions. |
| C-02 | Partially fixed | Student duplicates, A-Level learners, marks, reports, exports, and teacher directory now require admin authentication. Admin frontend report/enrollment callers were updated to use admin credentials. A complete record-level authorization matrix and controlled integration tests remain. |
| C-03 | Partially fixed | Socket handshake verifies a Vine token/session and server derives identity from `socket.data.userId`; client `register(userId)` was removed. eClass now derives join identity from the handshake and rechecks live membership before room actions. Socket integration tests remain. |
| H-01 | Fixed in source | Both public teacher signup endpoints return 403; existing admin provisioning remains the approval path. |
| H-02 | Partially fixed | Teacher and Vine reset codes are cryptographically generated, hashed, and short-lived; teacher reset JWTs are purpose-limited. Attempt counters and issuance throttles remain to be completed. |
| H-03 | Partially fixed | Preview URLs restrict protocols/ports, reject non-public resolved IPs and credentials, and do not follow redirects. Fetch is not yet DNS-pinned to the validated address. |
| H-04 | Partially fixed | Memory upload limits were reduced and counts/parts bounded. Replace memory storage with streamed temporary/object storage and add content-byte validation/concurrency controls. |
| H-05 | Partially fixed | A MySQL-backed, multi-instance limiter now protects teacher and Vine reset issuance/verification with IP and account keys and fails closed in production if its store is unavailable. Login, boarding, admin, and signup routes still need the same policy; proxy trust configuration remains deployment work. |
| H-06 | Blocked | Fresh audits could not contact npm registry (`ENOTFOUND registry.npmjs.org`); no dependency changes were made without advisory paths. |
| H-07 | Partially fixed | Development listen defaults to `127.0.0.1`; MySQL/proxy/firewall changes require deployment access. |
| M-01 | Fixed in source | Unknown request hosts no longer become redirect targets; production should set the explicit public base URL. |
| M-02 | Fixed in source | Teacher directory requires admin authentication and omits email. |
| M-03 | Partially fixed | `X-Powered-By` is disabled and baseline response headers added. A final centralized production error handler/CSP needs compatibility testing. |
| M-04 | Fixed in source | Unsafe JWT and first-admin fallbacks were removed; explicit provisioning is required. |
| L-01 | Partially fixed | Examples and rollout instructions document `0600`; existing local file modes were not changed to avoid modifying user secrets. |
| L-02 | Fixed in source | Duplicate Vine router mount was removed. |

## Verification performed

- `node --test backend/middleware/databaseRateLimit.test.js`: passed; the fourth same-IP/account request received 429 after three allowed attempts.
- `node --check` passed for the server, teacher, Vine, eClass, and limiter modules.
- `npm --prefix frontend run build`: passed after protected-caller changes (Vite emitted chunk-size warnings).
- `git diff --check`: passed.
- Fresh production audits were retried for backend and frontend but failed because the execution environment could not resolve `registry.npmjs.org` (`getaddrinfo ENOTFOUND`).

## Public-exposure blocker

Do not expose this revision publicly until the remaining partial items receive controlled integration tests, especially record-level authorization, login throttling, streamed uploads, and DNS-pinned SSRF egress.

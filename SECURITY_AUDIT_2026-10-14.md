# SPESS ARK / Vine Local Security Assessment

**Assessment date:** 14 October 2026  
**Scope:** `/Users/malelincoln/spess_ark`, the locally running backend on port 5001, the local frontend service, and passively observed listening services on the development machine.  
**Method:** source-assisted penetration testing (authenticated and unauthenticated perspectives), dependency auditing, configuration review, and non-destructive HTTP/WebSocket probes.

## Executive summary

The application is **not safe to expose to the public internet or an untrusted LAN in its current state**. The assessment confirmed three critical security issues:

1. Known default boarding-admin credentials issue a valid administrator token.
2. Student, learner, marks, and report endpoints expose private school data without authentication; several learner endpoints also permit unauthenticated creation, modification, and deletion.
3. Socket.IO trusts a client-supplied user ID, allowing an unauthenticated connection to impersonate another Vine user and subscribe to that user's real-time rooms.

The local backend and MySQL are listening on all interfaces, which makes these application weaknesses reachable from other devices on the same network unless an effective host firewall blocks them.

No destructive actions were performed. The assessment did not create accounts, change passwords, delete records, enter private message rooms, trigger SSRF against internal services, or send oversized uploads.

## Risk summary

| Severity | Count |
|---|---:|
| Critical | 3 |
| High | 7 |
| Medium | 4 |
| Low | 2 |

## Critical findings

### C-01 — Default boarding administrator credentials are active

**Impact:** Full boarding-administration access, including student and marks management.

**Evidence:**

- `backend/modules/boarding/boarding.routes.js:336-359` falls back to username `boarding` and password `boarding` when environment variables are missing.
- Both boarding credential environment variables are currently absent.
- A non-destructive request to `POST /api/boarding/login` using the documented fallback returned HTTP 200 and issued a token with role `boarding_admin`.

**Remediation:**

- Remove both fallback values and fail application startup when either secret is missing.
- Set a long random boarding-admin credential immediately.
- If port 5001 has ever been reachable by another device, invalidate already-issued boarding tokens. The current shared JWT design may require rotating `JWT_SECRET`, which signs out all users; a dedicated boarding secret plus revocable sessions is preferable.
- Add rate limiting and security-event alerts to the boarding login route.

### C-02 — Broken access control exposes and permits modification of learner data

**Impact:** Unauthenticated disclosure of student PII and academic records; unauthorized creation and destructive modification of school records.

**Evidence:**

- `backend/routes/students.js:7-19` exposes every active O-Level student using `SELECT *` without authentication.
- `backend/server.js:1920-1963` permits unauthenticated student creation.
- `backend/modules/alevel/alevel.routes.js:274-278` exposes A-Level learner read, create, update, and delete routes without `authAdmin`.
- `backend/modules/alevel/alevel.controller.js` deletion removes learner marks, subject registrations, and the learner record.
- `backend/modules/alevel/alevel.routes.js:1235-1319` exposes marks sets and detailed marks under paths labelled `admin` without authentication.
- `backend/modules/alevel/alevel.routes.js:1928-1997` and `2162-2199` expose marks previews and CSV exports without authentication.
- `backend/modules/alevel/alevelReports.js:293-365` begins unauthenticated report preview/download flows.
- Read-only validation returned 19 O-Level student records and 12 A-Level learner records. Returned fields included names, DOB, gender, class/stream or house, and subjects. Public A-Level mark-set endpoints returned 36 sets.

**Remediation:**

- Apply `authAdmin` at the router or route-group level to all administrative learner, marks, report, download, and mutation endpoints.
- Remove duplicate/public student list routes. Select only fields each role needs; do not use `SELECT *` for user-facing responses.
- Create separate, deliberately public aggregate endpoints if public statistics are required.
- Add authorization integration tests asserting 401/403 for every protected route and role.
- Review access logs for anonymous use of these endpoints and treat exposed student data as a potential privacy incident if production is similarly configured.

### C-03 — Socket.IO user impersonation enables real-time DM interception

**Impact:** An unauthenticated attacker can claim another user's numeric ID, join that user's room, spoof presence, and potentially receive future private-message, group-message, read-receipt, typing, and call-signalling events.

**Evidence:**

- `backend/server.js:4158-4184` accepts every Socket.IO connection and handles `register(userId)` by trusting the client-supplied number.
- The server then joins `user-{id}` and stores that unverified identity in `socketToUserId`.
- `backend/server.js:4186-4190` authorizes conversation-room membership using the spoofed identity.
- DM routes emit full hydrated messages to `conversation-{id}` and `user-{id}` rooms, for example `backend/modules/vine/dms.js:1741-1745`.
- A live probe confirmed that Socket.IO accepted a connection with no token or credentials. The test disconnected without registering an identity or entering a user/conversation room.

**Remediation:**

- Add `io.use()` authentication that verifies the Vine JWT during the handshake and checks session revocation.
- Set identity exclusively as `socket.data.userId` from the verified token. Delete the client-controlled `register(userId)` identity mechanism.
- Reauthorize every room join against `socket.data.userId`; never accept `fromUserId` or actor IDs from event payloads.
- Add negative tests for missing, expired, revoked, and user-mismatched tokens.
- Consider disconnecting all sockets when a session is revoked, an account is suspended, or the password changes.

## High findings

### H-01 — Anyone can create an immediately verified teacher account

`backend/routes/teachers.js:161-205` and `backend/routes/newSignup.js:8-47` both allow public teacher registration and insert `is_verified = 1`. There is no invite, approval, domain restriction, or rate limit, and password hashing uses bcrypt cost 6.

**Fix:** Disable one route, require an admin-created invite or pending approval, enforce stronger password policy, use the project's normal bcrypt cost, and rate-limit registration.

### H-02 — Password reset flows are brute-forceable and teacher reset tokens are over-privileged

Vine and teacher password resets use four-digit `Math.random()` codes valid for 15 minutes with no attempt counter or rate limit (`backend/routes/teachers.js:324-403`, `backend/modules/vine/vineRoutes.js:9940-10007`). A successful teacher code returns a JWT marked `resetOnly`, but `backend/middleware/authTeacher.js:5-44` accepts that token for every teacher-protected route.

**Fix:** Use cryptographically random, single-use reset secrets (or at least six digits), store a hash, cap attempts per account and IP, throttle issuance, invalidate older codes, and use a dedicated middleware that accepts reset tokens only on the reset endpoint.

### H-03 — Link-preview fetcher can be used for server-side request forgery (SSRF)

`backend/modules/vine/vineRoutes.js:6571-6607` checks only the initial hostname and then follows redirects automatically. A public URL can redirect to a private/LAN/metadata address; DNS rebinding and alternative IP encodings are also insufficiently covered.

**Fix:** Resolve DNS and reject every non-public address, disable automatic redirects and validate each redirect hop, block metadata/link-local/reserved ranges for IPv4 and IPv6, restrict ports and protocols, limit response bytes while streaming, and preferably fetch through an isolated outbound proxy.

### H-04 — In-memory upload limits allow easy process exhaustion

`backend/middleware/upload.js:8-30` buffers post uploads up to 500 MB and support archives up to 200 MB in process memory. Authentication runs first on sampled routes, but any ordinary authenticated account can force very large allocations; concurrent requests multiply the impact. The installed Multer version also has known DoS advisories.

**Fix:** Stream directly to object storage, reduce per-file and per-request limits, enforce total request/concurrency limits at the proxy, validate content type from file bytes, and upgrade Multer.

### H-05 — Login and verification endpoints lack rate limiting

Admin, teacher, Vine, and boarding login routes have no request throttling. Vine/teacher reset verification is also unlimited. The parent portal contains a custom limiter, demonstrating that protections are inconsistent.

**Fix:** Add a shared, proxy-aware rate limiter backed by Redis or another shared store, with per-IP and per-account buckets, progressive delay, safe generic responses, and alerting. Do not rely on an in-process map in a multi-instance deployment.

### H-06 — Production dependency vulnerabilities are present

`npm audit --omit=dev` reported:

- Backend: 21 vulnerabilities — 1 critical, 13 high, 6 moderate, 1 low.
- Frontend: 8 vulnerabilities — 1 critical, 4 high, 3 moderate.

Notable direct dependencies include Cloudinary 1.41.3, Multer 2.0.2, mysql2 3.15.3, Nodemailer 7.0.11, Sharp 0.33.5, jsPDF 3.0.4, and React Router DOM 7.12.0. jsPDF is used widely for school reports, so its critical advisory deserves prompt reachability testing and upgrade validation.

**Fix:** Upgrade in a branch with regression tests. Prioritize Multer, mysql2, Cloudinary, jsPDF, React Router, Socket.IO's vulnerable transitive chain, and the critical `proxy-addr` dependency. Avoid applying major-version audit fixes blindly.

### H-07 — Development backend and MySQL listen on every network interface

Passive socket inspection showed Node on `*:5001` and MySQL on `*:3306`/`*:33060`. The frontend is loopback-only. This exposes the vulnerable backend and database service to the LAN unless the macOS firewall blocks access.

**Fix:** Bind local development services to `127.0.0.1`/`::1`, configure MySQL `bind-address` for loopback, remove remote database grants that are not required, require TLS for any intentional remote database connection, and verify host-firewall rules.

## Medium findings

### M-01 — Host-header injection produces an open redirect

`backend/server.js:76-114` builds the frontend redirect from `X-Forwarded-Host` or `Host` when no explicit public base URL exists. A request with `Host: evil.example` returned `Location: http://evil.example/vine/feed`.

**Fix:** Set `VINE_PUBLIC_BASE_URL`, allowlist known hosts, reject unrecognized hosts, and trust forwarded headers only from a configured reverse proxy.

### M-02 — Public teacher directory exposes email addresses

`backend/server.js:186-190` returns teacher IDs, names, and email addresses without authentication. Live validation confirmed the endpoint returns real teacher records.

**Fix:** Require an appropriate role, omit email unless necessary, and provide a separate minimal public directory if the product requires one.

### M-03 — Error responses disclose internal paths and security headers are incomplete

Malformed JSON returned an HTML stack trace containing absolute filesystem paths and dependency internals. Normal backend responses expose `X-Powered-By: Express` and lack a consistent CSP, frame protection, HSTS, referrer policy, and permissions policy.

**Fix:** Add a final JSON error handler that hides stack traces outside logs, set `NODE_ENV=production`, disable `x-powered-by`, and use Helmet or equivalent explicit headers at the production edge.

### M-04 — Authentication secrets fail open to known defaults

Multiple middleware and signing paths fall back to `dev_secret` or `vine_secret_key` when `JWT_SECRET` is missing. Admin credential bootstrap also falls back to `admin/admin` for a fresh database (`backend/server.js:1033-1062`). The current local admin rejected `admin/admin`, and a non-default JWT secret is present, but a fresh or misconfigured deployment becomes predictable instead of refusing to start.

**Fix:** Validate required secrets at startup, require sufficient entropy, remove all production fallbacks, and keep development defaults in an explicit test-only configuration.

## Low findings

### L-01 — Environment files have permissive local filesystem modes

`backend/.env`, `frontend/.env`, and `frontend/.env.local` are mode `0644`; `backend/.env.local` is `0600`. Backend environment files are not tracked by Git, and the tracked frontend `.env` contains only the public `VITE_API_BASE` variable.

**Fix:** Set secret-bearing environment files to `0600` and document that `VITE_*` values are public at build time.

### L-02 — Vine router is mounted twice

`backend/server.js:159-161` mounts the same `vineRoutes` router twice around an effectively separate auth router. This can cause duplicate middleware execution, surprising route behavior, and a larger audit surface.

**Fix:** Mount each router exactly once and add a route-table smoke test.

## Controls that behaved correctly

- A hostile Origin did not receive `Access-Control-Allow-Origin`; the configured localhost origin did.
- Anonymous requests to sampled protected admin and Vine endpoints returned 401.
- Directory listing for `/uploads/` was not enabled.
- `DISABLE_ADMIN_AUTH` is currently false.
- The current admin account rejected `admin/admin`.
- Backend secret files are ignored by Git.
- No `dangerouslySetInnerHTML` usage was found in the React source during the targeted search.

## Immediate containment order

1. Replace boarding defaults, restart, and decide whether JWT rotation is required.
2. Bind port 5001 and MySQL to loopback while local testing continues.
3. Put `authAdmin` in front of all student/A-Level learner, marks, report, download, and mutation routes.
4. Disable the unauthenticated Socket.IO identity registration until token-bound socket authentication is deployed.
5. Disable public teacher self-registration or switch it to pending approval.
6. Add rate limits to all login and reset endpoints.
7. Patch SSRF and upload-memory risks.
8. Upgrade vulnerable dependencies under regression tests.

## Retest requirements

A security retest should verify:

- Default and missing-secret startup paths fail closed.
- Every private endpoint returns 401 without a token and 403 for the wrong role.
- Socket connections without a valid, non-revoked token are rejected before `connect`.
- A user cannot join another user's room or a conversation they do not belong to.
- Reset codes lock after a small number of attempts and cannot authorize normal teacher APIs.
- Redirect chains, DNS rebinding, IPv4/IPv6 encodings, and metadata addresses are blocked by link previews.
- Oversized and concurrent uploads are rejected without proportional memory growth.
- Dependency audits and application tests pass after upgrades.

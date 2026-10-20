# Security rollout checklist

## Before deployment

1. Back up the database and preserve application/proxy logs outside the host.
2. Set `JWT_SECRET`, `BOARDING_ADMIN_USERNAME`, and `BOARDING_ADMIN_PASSWORD` to unique random values (32+ characters); set `ADMIN_USERNAME` and `ADMIN_PASSWORD` only when provisioning an empty database.
3. Set `VINE_PUBLIC_BASE_URL` to the exact HTTPS frontend URL and `HOST=0.0.0.0` only for the hosted service. Local development defaults to `127.0.0.1`.
4. Set secret-bearing `.env` files to mode `0600`; keep them out of Git. `VITE_*` values are public build-time values.
5. Configure the reverse proxy to reject bodies above the application limits (15 MB posts, 50 MB support archives), enforce request timeouts, and pass forwarded headers only from the proxy.
6. Bind MySQL to loopback/private networking, remove unnecessary remote grants, and require TLS for intentional remote database access.

## Deployment and validation

1. Deploy backend and frontend together: sockets now require `auth.token` and do not support `register(userId)`.
2. Restart the service and confirm startup fails if any required secret is absent or unsafe.
3. Rotate the JWT secret and revoke existing Vine sessions if the previous secret/default credentials may have been exposed. Changing a password alone does not revoke old JWTs.
4. Check anonymous requests to `/api/students`, `/api/alevel/learners`, reports, marks, and teacher directory return 401; verify legitimate admin and teacher workflows.
5. Confirm socket connections without a current Vine session are rejected and inspect error logs without logging tokens.

## Rollback

Keep the previous build and database backup. If rollback is necessary, restore only the application build first; do not restore database data unless a migration was separately approved. Preserve access logs and security-event evidence. Do not re-enable public student routes, default credentials, or unauthenticated sockets as a rollback shortcut.

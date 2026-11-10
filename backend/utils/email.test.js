import assert from "node:assert/strict";
import test from "node:test";

import { sendWithRetry } from "./email.js";

const payload = {
  from: "SPESS ARK <no-reply@stphillipsequatorial.com>",
  to: "teacher@example.com",
  subject: "Reset code",
  html: "<p>123456</p>",
};

test("sendWithRetry returns a successful Resend response", async () => {
  const client = {
    emails: {
      send: async () => ({ data: { id: "email_123" }, error: null }),
    },
  };

  const result = await sendWithRetry(payload, 0, client);
  assert.equal(result.data.id, "email_123");
});

test("sendWithRetry throws when Resend returns an API error", async () => {
  let attempts = 0;
  const client = {
    emails: {
      send: async () => {
        attempts += 1;
        return {
          data: null,
          error: { message: "API key is invalid", statusCode: 401, name: "validation_error" },
        };
      },
    },
  };

  await assert.rejects(
    sendWithRetry(payload, 2, client),
    /API key is invalid/
  );
  assert.equal(attempts, 1, "permanent API errors must not be retried");
});

test("sendWithRetry retries transient failures", async () => {
  let attempts = 0;
  const client = {
    emails: {
      send: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: { message: "Service unavailable", statusCode: 503 },
          };
        }
        return { data: { id: "email_456" }, error: null };
      },
    },
  };

  const result = await sendWithRetry(payload, 1, client);
  assert.equal(attempts, 2);
  assert.equal(result.data.id, "email_456");
});

test("sendWithRetry rejects an empty success response", async () => {
  const client = {
    emails: {
      send: async () => ({ data: null, error: null }),
    },
  };

  await assert.rejects(
    sendWithRetry(payload, 0, client),
    /no email delivery ID/
  );
});

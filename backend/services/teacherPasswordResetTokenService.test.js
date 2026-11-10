import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import {
  TEACHER_PASSWORD_RESET_PURPOSE,
  signTeacherPasswordResetToken,
  verifyTeacherPasswordResetToken,
} from "./teacherPasswordResetTokenService.js";

const secret = "test-reset-secret-that-is-long-enough";

test("creates and verifies a teacher password-reset-only token", () => {
  const token = signTeacherPasswordResetToken(
    { id: 42, email: "teacher@example.com" },
    secret
  );
  const decoded = verifyTeacherPasswordResetToken(token, secret);

  assert.equal(decoded.id, 42);
  assert.equal(decoded.role, "teacher");
  assert.equal(decoded.purpose, TEACHER_PASSWORD_RESET_PURPOSE);
  assert.equal(decoded.resetOnly, true);
});

test("rejects an ordinary teacher session token", () => {
  const ordinaryToken = jwt.sign(
    { id: 42, role: "teacher", session_mode: "browser_session" },
    secret
  );

  assert.throws(
    () => verifyTeacherPasswordResetToken(ordinaryToken, secret),
    /reset token purpose/
  );
});


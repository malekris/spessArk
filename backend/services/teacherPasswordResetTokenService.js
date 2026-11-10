import jwt from "jsonwebtoken";

export const TEACHER_PASSWORD_RESET_PURPOSE = "teacher_password_reset";

export function signTeacherPasswordResetToken(teacher, secret) {
  return jwt.sign(
    {
      id: teacher.id,
      email: teacher.email,
      role: "teacher",
      purpose: TEACHER_PASSWORD_RESET_PURPOSE,
      resetOnly: true,
    },
    secret,
    { expiresIn: "20m" }
  );
}

export function verifyTeacherPasswordResetToken(token, secret) {
  const decoded = jwt.verify(token, secret);
  if (
    decoded?.role !== "teacher" ||
    decoded?.purpose !== TEACHER_PASSWORD_RESET_PURPOSE ||
    decoded?.resetOnly !== true
  ) {
    throw new Error("Invalid password reset token purpose");
  }
  return decoded;
}


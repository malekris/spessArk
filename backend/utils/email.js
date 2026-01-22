import { Resend } from "resend";
import jwt from "jsonwebtoken";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(email, teacherId, name = "") {
  console.log("📧 Preparing verification email for:", email);

  const token = jwt.sign(
    { id: teacherId },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );

  const verifyUrl = `http://localhost:5001/api/teachers/verify/${token}`;

  const { error } = await resend.emails.send({
    from: "SPESS ARK <no-reply@stphillipsequatorial.com>", // works instantly
    to: email,
    subject: "Verify your SPESS Ark teacher account",
    html: `
      <div style="font-family: Arial, sans-serif">
        <h2>Welcome to SPESS Ark${name ? `, ${name}` : ""}</h2>
        <p>Please verify your email to activate your account.</p>
        <p>
          <a href="${verifyUrl}"
             style="padding:10px 16px;
                    background:#2563eb;
                    color:white;
                    text-decoration:none;
                    border-radius:6px;">
            Verify Email
          </a>
        </p>
        <p>This link expires in 24 hours.</p>
      </div>
    `,
  });

  if (error) {
    console.warn("⚠️ Email failed:", error.message);
    throw new Error(error.message);
  }

  console.log("✅ Verification email sent to:", email);
}

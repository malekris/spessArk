// backend/utils/email.js
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";

export async function sendVerificationEmail(email, teacherId) {
  console.log("📧 Preparing verification email for:", email);

  const token = jwt.sign(
    { id: teacherId },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "24h" }
  );

  const verifyUrl = `http://localhost:5001/api/teachers/verify/${token}`;

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Verify your SPESS Ark teacher account",
    html: `
      <div style="font-family: Arial, sans-serif">
        <h2>Welcome to SPESS Ark</h2>
        <p>Please verify your email address to activate your teacher account.</p>
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
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("✅ Verification email sent:", info.messageId);
}

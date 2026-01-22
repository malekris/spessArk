import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail(email, name = "") {
  console.log("📧 Sending welcome email to:", email);

  const { error } = await resend.emails.send({
    from: "SPESS ARK <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Welcome to SPESS ARK 🎓",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9fafb; padding:30px;">
        <div style="max-width:600px; margin:auto; background:white; padding:30px; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.05);">

          <h2 style="color:#111827;">Welcome${name ? ` ${name}` : ""},</h2>

          <p style="font-size:15px; color:#374151;">
            Your teacher account has been successfully created on 
            <strong>SPESS ARK</strong> — the School Performance & Examination Support System.
          </p>

          <p style="font-size:15px; color:#374151;">
            SPESS ARK is designed to simplify your academic work and support better learning outcomes.
          </p>

          <h4 style="margin-top:20px;">With SPESS ARK, you can:</h4>
          <ul style="color:#374151; font-size:15px;">
            <li>Manage your classes and subjects easily</li>
            <li>Submit marks digitally</li>
            <li>Track learner performance</li>
            <li>Access academic reports anytime</li>
          </ul>

          <p style="font-size:15px; color:#374151;">
            You can now log in using your email and password on the school portal.
          </p>

          <div style="margin:30px 0;">
            <p style="font-size:14px; color:#6b7280;">
              If you experience any difficulty, please contact your school administrator for assistance.
            </p>
          </div>

          <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;" />

          <p style="font-size:13px; color:#9ca3af;">
            SPESS ARK — Empowering schools through technology.<br/>
            © ${new Date().getFullYear()} SPESS ARK
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

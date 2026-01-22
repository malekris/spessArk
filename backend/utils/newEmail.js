import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail(email, name) {
  console.log("📨 Sending welcome email to:", email);

  const { error } = await resend.emails.send({
    from: "SPESS ARK <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Welcome to SPESS ARK 🎓",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px">
        <h2>Welcome ${name},</h2>
        <p>Your teacher account has been created successfully on <strong>SPESS ARK</strong>.</p>

        <p>You can now:</p>
        <ul>
          <li>Log in to your dashboard</li>
          <li>Submit marks</li>
          <li>Manage your classes</li>
          <li>Track student performance</li>
        </ul>

        <p>If you need help, contact your administrator.</p>

        <br />
        <p style="color: #777">SPESS ARK — School Performance & Examination Support System</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

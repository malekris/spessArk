import { Resend } from "resend";

// Custom fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Resend client with custom fetch
const resend = new Resend(process.env.RESEND_API_KEY, {
  fetch: fetchWithTimeout,
});

// Retry wrapper (important on flaky networks)
async function sendWithRetry(payload, retries = 2) {
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      console.log(`📨 Resend attempt ${attempt}`);
      const result = await resend.emails.send(payload);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Email attempt ${attempt} failed:`, err.message);

      // small delay before retry
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  throw lastError;
}

export async function sendWelcomeEmail(email, name = "") {
  console.log("📧 Sending welcome email to:", email);

  const payload = {
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
  };

  const start = Date.now();

  try {
    const result = await sendWithRetry(payload, 2); // 2 retries = up to 3 attempts
    console.log(`✅ Email sent to ${email} in ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.error(
      `❌ Email permanently failed after ${Date.now() - start}ms:`,
      err.message
    );
    throw err;
  }
}

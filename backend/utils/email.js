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
    <div style="max-width:600px; margin:auto; background:white; padding:32px; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,0.06);">

      <h2 style="color:#111827; font-size:22px;">
        Welcome${name ? ` ${name}` : ""} 👋
      </h2>

      <p style="font-size:15px; color:#374151; line-height:1.6;">
        We’re glad to have you on board.
      </p>

      <p style="font-size:15px; color:#374151; line-height:1.6;">
        Your teacher account on <strong>SPESS ARK</strong> has been successfully created.
        This platform was introduced to support your work and make academic processes simpler, faster, and more organized.
      </p>

      <div style="background:#f3f4f6; padding:14px 16px; border-radius:10px; margin:20px 0;">
        <p style="margin:0; font-size:14px; color:#374151;">
          <strong>SPESS ARK is built for the teachers of</strong><br/>
          St. Phillips Equatorial Secondary School, Nabusanke.
        </p>
      </div>

      <h4 style="margin-top:24px; color:#111827;">With SPESS ARK, you can:</h4>
      <ul style="color:#374151; font-size:15px; line-height:1.7;">
        <li>Manage your classes and subjects with ease</li>
        <li>Submit marks digitally without paperwork stress</li>
        <li>Track learner performance clearly</li>
        <li>Access reports anytime, from anywhere</li>
      </ul>

      <p style="font-size:15px; color:#374151; line-height:1.6;">
        You can now log in using your email and the password you provided during registration.
      </p>

      <p style="font-size:15px; color:#374151; line-height:1.6;">
        If you experience any difficulty, please feel free to reach out to your school administrator for assistance.
        Support is always available.
      </p>

      <hr style="border:none; border-top:1px solid #e5e7eb; margin:26px 0;" />

      <p style="font-size:13px; color:#9ca3af; line-height:1.6;">
        SPESS ARK — Empowering St. Phillip through thoughtful technology.<br/>
        © ${new Date().getFullYear()} SPESS ARK
      </p>
    </div>
  </div>
`

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

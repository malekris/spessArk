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
      <div style="max-width:600px; margin:auto; background:white; padding:36px; border-radius:16px; box-shadow:0 15px 40px rgba(0,0,0,0.08);">
  
        <!-- Logo -->
        <div style="text-align:center; margin-bottom:20px;">
          <img 
            src="https://stphillipsequatorial.com/badge.png" 
            alt="St. Phillips Badge" 
            style="height:90px;"
          />
        </div>
  
        <h2 style="color:#111827; font-size:22px;">
          Welcome Teacher ${name ? ` ${name}` : ""} 👋
        </h2>
  
        <p style="font-size:15px; color:#374151; line-height:1.7;">
          We’re glad to have you on board.
        </p>
  
        <p style="font-size:15px; color:#374151; line-height:1.7;">
          Your teacher account on <strong>SPESS ARK</strong> has been successfully created.
          This platform was introduced to support your work and make academic processes simpler, faster, and more organized.
        </p>
  
        <div style="background:#fff7e6; border-left:5px solid #d4a017; padding:16px; border-radius:10px; margin:22px 0;">
          <p style="margin:0; font-size:14.5px; color:#374151;">
            <strong>SPESS ARK is built for the teachers of</strong><br/>
            St. Phillips Equatorial Secondary School, Nabusanke.
          </p>
        </div>
  
        <h4 style="margin-top:26px; color:#111827;">With SPESS ARK, you can:</h4>
        <ul style="color:#374151; font-size:15px; line-height:1.8;">
          <li>Manage your classes and subjects with ease</li>
          <li>Submit marks digitally without paperwork stress</li>
          <li>Track learner performance clearly</li>
          <li>Access reports anytime, from anywhere</li>
        </ul>
  
        <p style="font-size:15px; color:#374151; line-height:1.7;">
          You can now log in using your email and the password you provided during registration.
        </p>
  
        <!-- Button -->
        <div style="margin:30px 0; text-align:center;">
          <a href="https://stphillipsequatorial.com" 
             style="background:#d4a017; color:white; text-decoration:none; padding:14px 26px; border-radius:10px; font-weight:600; font-size:15px; display:inline-block;">
            Open SPESS ARK
          </a>
        </div>
  
        <p style="font-size:15px; color:#374151; line-height:1.7;">
          If you experience any difficulty, please reach out to your school administrator for assistance.
        </p>
  
        <!-- Signature -->
        <div style="margin-top:28px;">
          <p style="margin:0; font-size:15px; color:#111827;"><strong>Mr. Male </strong></p>
          <p style="margin:0; font-size:14px; color:#6b7280;">Teacher of ICT</p>
        </div>
  
        <hr style="border:none; border-top:1px solid #e5e7eb; margin:28px 0;" />
  
        <!-- Footer -->
        <p style="font-size:13px; color:#9ca3af; line-height:1.7; text-align:center;">
          SPESS ARK — Empowering schools through thoughtful technology.<br/>
          <em>"Work and Live by Faith"</em><br/>
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

export async function sendVineWelcomeEmail(email, username) {
  console.log("📧 Sending VINE welcome email to:", email);

  const payload = {
    from: "SPESS VINE 🌱 <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Welcome to SPESS VINE 🌱",
    html: `
      <div style="font-family: Arial; background:#f0fdf4; padding:30px;">
        <div style="max-width:600px; margin:auto; background:white; padding:32px; border-radius:18px;">
          
          <h2 style="color:#14532d;">Welcome to SPESS VINE 🌱</h2>

          <p>Hello ${username},</p>

          <p>
            You’re now part of the student community at  
            <strong>St. Phillips Equatorial Secondary School</strong>.
          </p>

          <p>
            SPESS VINE is your space to:
          </p>

          <ul>
            <li>📢 Share updates</li>
            <li>💬 Comment on posts</li>
            <li>🤝 Follow friends</li>
            <li>📸 Post photos</li>
          </ul>

          <div style="text-align:center;margin:30px 0;">
            <a href="https://stphillipsequatorial.com/vine/login"
              style="background:#22c55e;color:white;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold;">
              Enter SPESS VINE 🌱
            </a>
          </div>

          <p style="font-size:13px;color:#777;text-align:center;">
            SPESS VINE — Student community platform
          </p>
        </div>
      </div>
    `
  };

  await sendWithRetry(payload, 2);
  console.log("📧 Vine welcome email sent");
}

export async function sendVineResetCodeEmail(email, code) {
  console.log("📧 Sending VINE reset code to:", email);

  const payload = {
    from: "SPESS VINE 🌱 <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Your SPESS VINE reset code",
    html: `
      <div style="font-family: Arial; background:#f0fdf4; padding:30px;">
        <div style="max-width:600px; margin:auto; background:white; padding:32px; border-radius:18px;">
          <h2 style="color:#14532d;">Reset your SPESS VINE password</h2>
          <p>Use this 4‑digit code to reset your password:</p>
          <div style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#111827;margin:18px 0;">
            ${code}
          </div>
          <p style="font-size:13px;color:#777;">
            This code expires in 15 minutes. If you didn't request this, you can ignore this email.
          </p>
        </div>
      </div>
    `,
  };

  await sendWithRetry(payload, 2);
  console.log("📧 Vine reset code sent");
}

export async function sendVineVerificationCodeEmail(email, code) {
  console.log("📧 Sending VINE verification code to:", email);

  const payload = {
    from: "SPESS VINE 🌱 <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Your SPESS VINE verification code",
    html: `
      <div style="font-family: Arial; background:#f0fdf4; padding:30px;">
        <div style="max-width:600px; margin:auto; background:white; padding:32px; border-radius:18px;">
          <h2 style="color:#14532d;">Verify your email</h2>
          <p>Enter this code in your settings to get your checkmark:</p>
          <div style="text-align:center;margin:26px 0; font-size:28px; letter-spacing:6px; font-weight:bold; color:#0f5132;">
            ${code}
          </div>
          <p style="font-size:13px;color:#777;">
            This code expires in 15 minutes. If you didn’t request this, you can ignore it.
          </p>
        </div>
      </div>
    `,
  };

  await sendWithRetry(payload, 2);
  console.log("📧 Vine verification code sent");
}

export async function sendTeacherResetCodeEmail(email, code) {
  console.log("📧 Sending TEACHER reset code to:", email);

  const payload = {
    from: "SPESS ARK <no-reply@stphillipsequatorial.com>",
    to: email,
    subject: "Your SPESS ARK reset code",
    html: `
      <div style="font-family: Arial; background:#0f172a; padding:30px;">
        <div style="max-width:600px; margin:auto; background:white; padding:32px; border-radius:18px;">
          <h2 style="color:#0f172a;">Reset your Teacher password</h2>
          <p>Use this 4-digit code to reset your password:</p>
          <div style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#111827;margin:18px 0;">
            ${code}
          </div>
          <p style="font-size:13px;color:#777;">
            This code expires in 15 minutes. If you didn’t request this, you can ignore this email.
          </p>
        </div>
      </div>
    `,
  };

  await sendWithRetry(payload, 2);
  console.log("📧 Teacher reset code sent");
}

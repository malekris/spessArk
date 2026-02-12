import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./VineHelpCenter.css";

export default function VineHelpCenter() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Vine — Help Center";
  }, []);

  return (
    <div className="vine-help-page">
      <div className="vine-help-topbar">
        <button onClick={() => navigate(-1)}>← Back</button>
        <h2>Vine Help Center</h2>
      </div>

      <div className="vine-help-grid">
        <section className="vine-help-card">
          <h3>Getting Started</h3>
          <ul>
            <li>Create posts with text and photos.</li>
            <li>Use `@username` mentions to notify people.</li>
            <li>Use `🔖` to bookmark posts.</li>
            <li>Use DMs for private conversations.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Reporting & Safety</h3>
          <ul>
            <li>Use the `⋯` menu on posts to report to Guardian.</li>
            <li>Use `Report` on comments/replies.</li>
            <li>Report categories: abuse, bad content, disinformation, privacy violation.</li>
            <li>Guardian can review and take action quickly.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Avoid Bans</h3>
          <ul>
            <li>No harassment, threats, or hate speech.</li>
            <li>No harmful misinformation or privacy leaks.</li>
            <li>No repeated spam/revine abuse.</li>
            <li>Respect people in comments and DMs.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>If You Get Suspended</h3>
          <ul>
            <li>You may lose like/comment access temporarily.</li>
            <li>You’ll get an in-app notification and email.</li>
            <li>Use <strong>Appeal to Guardian</strong> in feed if needed.</li>
            <li>Guardian can unsuspend early after review.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Account & Privacy</h3>
          <ul>
            <li>Use settings to control DM privacy and profile privacy.</li>
            <li>Hide like counts if you prefer less public metrics.</li>
            <li>Use mute/block tools for unwanted interactions.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Need More Help</h3>
          <ul>
            <li>Report abusive content directly from the post/comment.</li>
            <li>Use detailed report notes for faster moderation.</li>
            <li>If a bug happens, include screen + steps + time.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Password Reset</h3>
          <ul>
            <li>Use <strong>Forgot Password</strong> if you cannot sign in.</li>
            <li>Enter your account email to receive a 4-digit reset code.</li>
            <li>Reset codes expire quickly for security.</li>
            <li>If a code fails, request a new one instead of retrying many times.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Emails You May Receive</h3>
          <ul>
            <li>Welcome email after account creation.</li>
            <li>Password reset code email.</li>
            <li>Email verification code email.</li>
            <li>Suspension and unsuspension moderation emails.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Protect Secret Codes</h3>
          <ul>
            <li>Never share reset or verification codes with anyone.</li>
            <li>Guardian and support should never ask for your code.</li>
            <li>Do not post screenshots that show codes or private links.</li>
            <li>If you think a code leaked, request a new one immediately.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Account Recovery Tips</h3>
          <ul>
            <li>Keep your email active and accessible at all times.</li>
            <li>Use a strong password and avoid reusing old passwords.</li>
            <li>Update your password immediately after suspicious activity.</li>
            <li>Review account settings after recovery.</li>
          </ul>
        </section>

        <section className="vine-help-card">
          <h3>Common Scams</h3>
          <ul>
            <li><strong>Fake Guardian DM:</strong> “Send your code so we can verify you.” Never share codes.</li>
            <li><strong>Urgent account warning:</strong> “Your account will be deleted in 5 minutes unless you click this link.” Verify only from official Vine screens.</li>
            <li><strong>Impersonation accounts:</strong> Similar username/profile asking for money or access.</li>
            <li><strong>Off-platform phishing links:</strong> “Login here to unlock badge.” Do not enter credentials on unknown pages.</li>
            <li><strong>What to do:</strong> block, report, and avoid replying to scam messages.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

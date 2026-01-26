import { Link } from "react-router-dom";


export default function VineForgotPassword() {
  return (
    <div className="vine-auth-bg">
      <div className="vine-auth-card">
        <h2 className="vine-title">Forgot Password</h2>
        <p className="vine-subtitle">
          Enter your email and we’ll send you a reset link.
        </p>

        <form className="vine-form">
          <input type="email" placeholder="Your email" required />
          <button className="vine-btn">Send Reset Link</button>
        </form>

        <div className="vine-footer">
          Remembered? <Link to="/vine/login">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}

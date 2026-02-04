import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineVerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("Please wait while we confirm your email.");

  useEffect(() => {
    document.title = "Vine — Verifying Email";
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link.");
      return;
    }
    const verify = async () => {
      try {
        const res = await fetch(
          `${API}/api/vine/auth/verify-email?token=${encodeURIComponent(token)}`,
          { redirect: "follow" }
        );
        if (res.ok) {
          setStatus("success");
          setMessage("Email verified! Redirecting to your profile…");
          setTimeout(() => {
            window.location.href = "/vine/feed?verified=1";
          }, 1200);
        } else {
          const text = await res.text();
          setStatus("error");
          setMessage(text || "Verification failed.");
        }
      } catch (err) {
        setStatus("error");
        setMessage("Verification failed.");
      }
    };
    verify();
  }, [token]);

  return (
    <div className="vine-auth-bg">
      <div className="vine-auth-card">
        <h2 className="vine-title">
          {status === "success" ? "Verified!" : status === "error" ? "Verification failed" : "Verifying email…"}
        </h2>
        <p className="vine-subtitle">{message}</p>
      </div>
    </div>
  );
}

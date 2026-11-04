import { useEffect, useState } from "react";
import "./TeacherLoginNotice.css";

export default function TeacherLoginNotice({ apiBase, request }) {
  const [activeNotice, setActiveNotice] = useState(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem("teacherToken");
    if (!token || typeof request !== "function") return undefined;

    request(`${apiBase}/api/teachers/login-notice`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load teacher notice");
        return response.json();
      })
      .then((body) => {
        if (active) setActiveNotice(body?.notice || null);
      })
      .catch((loadError) => {
        // A notice should never prevent the dashboard from loading.
        console.warn("Teacher login notice unavailable:", loadError?.message || loadError);
      });

    return () => {
      active = false;
    };
  }, [apiBase, request]);

  if (!activeNotice) return null;

  const acknowledge = async () => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    setAcknowledging(true);
    setError("");
    try {
      const response = await request(`${apiBase}/api/teachers/login-notice/ack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: activeNotice.version }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 409) {
          const refreshed = await request(`${apiBase}/api/teachers/login-notice`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const refreshedBody = await refreshed.json().catch(() => null);
          if (refreshed.ok && refreshedBody?.notice) {
            setActiveNotice(refreshedBody.notice);
            setError("Administration updated this notice. Please review the latest message.");
            return;
          }
        }
        throw new Error(body?.message || "Failed to save acknowledgment");
      }
      setActiveNotice(null);
    } catch {
      setError("We could not save that yet. Please try again.");
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <div className="teacher-login-notice-backdrop" role="presentation">
      <section
        className="teacher-login-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-login-notice-title"
      >
        <div className="teacher-login-notice-accent" aria-hidden="true" />
        <div className="teacher-login-notice-label">
          <span aria-hidden="true" />
          Staff Notice
        </div>
        <p className="teacher-login-notice-source">From Administration</p>
        <h2 id="teacher-login-notice-title">
          {activeNotice.title || "A message from Administration"}
        </h2>
        <p className="teacher-login-notice-copy">{activeNotice.message}</p>

        {error && <div className="teacher-login-notice-error">{error}</div>}

        <button
          type="button"
          className="teacher-login-notice-confirm"
          onClick={acknowledge}
          disabled={acknowledging}
        >
          {acknowledging ? "Saving…" : "Okay"}
        </button>
      </section>
    </div>
  );
}

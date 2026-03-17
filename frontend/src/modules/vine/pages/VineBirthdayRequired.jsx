import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearVineAuth, getVineToken } from "../utils/vineAuth";
import "./VineBirthdayRequired.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const getTodayInputMax = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function VineBirthdayRequired() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = getVineToken();
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const safeReturnPath = useMemo(() => {
    const raw = location.state?.from;
    if (
      typeof raw === "string" &&
      raw.startsWith("/vine/") &&
      raw !== "/vine/birthday-required"
    ) {
      return raw;
    }
    return "/vine/feed";
  }, [location.state]);

  useEffect(() => {
    document.title = "Vine — Add your birthday";
  }, []);

  const handleLogout = () => {
    clearVineAuth();
    navigate("/vine/login", { replace: true });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!dateOfBirth) {
      setError("Please add your birthday before you continue.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const res = await fetch(`${API}/api/vine/users/me/birthday`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ date_of_birth: dateOfBirth }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || "We could not save your birthday right now.");
        return;
      }

      window.dispatchEvent(
        new CustomEvent("vine:birthday-updated", {
          detail: { date_of_birth: data?.date_of_birth || dateOfBirth },
        })
      );
      navigate(safeReturnPath, { replace: true });
    } catch {
      setError("We could not save your birthday right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vine-birthday-shell">
      <div className="vine-birthday-card">
        <div className="vine-birthday-kicker">SPESS VINE</div>
        <h1>Add your birthday</h1>
        <p className="vine-birthday-copy">
          We use birthdays to power upcoming birthday reminders across Vine.
          Only your month and day are shown to other people.
        </p>

        <form className="vine-birthday-form" onSubmit={handleSave}>
          <label htmlFor="vine-birthday-input">Date of birth</label>
          <input
            id="vine-birthday-input"
            type="date"
            max={getTodayInputMax()}
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
          />

          {error ? <div className="vine-birthday-error">{error}</div> : null}

          <div className="vine-birthday-actions">
            <button type="button" className="vine-birthday-logout" onClick={handleLogout}>
              Log out
            </button>
            <button type="submit" className="vine-birthday-save" disabled={saving}>
              {saving ? "Saving..." : "Save and continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import "./SuspendedProfileNotice.css";
import { useNavigate } from "react-router-dom";

export default function SuspendedProfileNotice({ isSelf = false, fallbackTo = "/vine/feed" }) {
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(fallbackTo, { replace: true });
  };

  return (
    <main className="vine-suspended-profile" aria-labelledby="vine-suspended-profile-title">
      <section className="vine-suspended-profile-banner" role="status">
        <button
          type="button"
          className="vine-suspended-profile-back"
          onClick={goBack}
          aria-label="Go back to the previous page"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="m14.5 6.5-5.5 5.5 5.5 5.5"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Go back</span>
        </button>

        <div className="vine-suspended-profile-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none">
            <path
              d="M12 3.2 20 6v5.7c0 4.6-3.1 7.7-8 9.3-4.9-1.6-8-4.7-8-9.3V6l8-2.8Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M12 8v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="12" cy="16.4" r="1.15" fill="currentColor" />
          </svg>
        </div>

        <div className="vine-suspended-profile-copy">
          <span>Vine Guardian notice</span>
          <h1 id="vine-suspended-profile-title">
            {isSelf ? "You have been suspended" : "This account has been suspended"}
          </h1>
          <p>
            {isSelf
              ? "Your profile and its content are unavailable while this suspension is active."
              : "This profile and all of its content are currently unavailable."}
          </p>
        </div>
      </section>
    </main>
  );
}

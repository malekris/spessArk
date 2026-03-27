import { NavLink, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { clearBoardingAuth, getBoardingToken, getBoardingUser } from "../api";

const NAV_ITEMS = [
  { label: "Overview", path: "/ark/boarding" },
  { label: "Learners", path: "/ark/boarding/learners" },
  { label: "Weekend Marks", path: "/ark/boarding/marks" },
  { label: "Reports", path: "/ark/boarding/reports" },
];

export default function BoardingAdminShell({ title, subtitle, children }) {
  const navigate = useNavigate();
  const user = getBoardingUser();

  useEffect(() => {
    if (!getBoardingToken()) {
      navigate("/ark/boarding-login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    document.title = title ? `${title} | SPESS ARK Boarding` : "SPESS ARK Boarding";
  }, [title]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(34,197,94,0.14), transparent 26%), linear-gradient(180deg, #08110d 0%, #0f172a 100%)",
        color: "#f8fafc",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(16px)",
          background: "rgba(8, 17, 13, 0.78)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            maxWidth: "1400px",
            margin: "0 auto",
            padding: "1rem 1.25rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.16em", color: "#4ade80", textTransform: "uppercase" }}>
              SPESS ARK
            </div>
            <div style={{ fontSize: "1.2rem", fontWeight: 900 }}>Boarding Assessments</div>
            <div style={{ fontSize: "0.84rem", color: "rgba(241,245,249,0.74)" }}>
              {user?.name || "Boarding Admin"}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => navigate("/ark")}
            >
              SPESS ARK
            </button>
            <button
              type="button"
              className="nav-logout"
              onClick={() => {
                clearBoardingAuth();
                navigate("/ark/boarding-login", { replace: true });
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem 1.25rem 2rem" }}>
        <section
          style={{
            borderRadius: "26px",
            overflow: "hidden",
            backgroundImage:
              "linear-gradient(to top, rgba(8,17,13,0.95) 0%, rgba(8,17,13,0.62) 22%, rgba(8,17,13,0.12) 56%), url('/cov.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center 38%",
            minHeight: "240px",
            display: "flex",
            alignItems: "flex-end",
            padding: "1.5rem",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 24px 50px rgba(2, 6, 23, 0.35)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.18em", color: "#4ade80", textTransform: "uppercase" }}>
              Boarding Manager
            </div>
            <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.35rem", fontWeight: 900, letterSpacing: "-0.04em" }}>{title}</h1>
            <p style={{ margin: "0.7rem 0 0", maxWidth: "760px", color: "rgba(241,245,249,0.86)", lineHeight: 1.6 }}>
              {subtitle}
            </p>
          </div>
        </section>

        <nav
          style={{
            marginTop: "1rem",
            display: "flex",
            gap: "0.7rem",
            flexWrap: "wrap",
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/ark/boarding"}
              style={({ isActive }) => ({
                textDecoration: "none",
                padding: "0.85rem 1rem",
                borderRadius: "14px",
                border: `1px solid ${isActive ? "rgba(74, 222, 128, 0.46)" : "rgba(255,255,255,0.09)"}`,
                background: isActive ? "rgba(34, 197, 94, 0.18)" : "rgba(15,23,42,0.56)",
                color: "#f8fafc",
                fontWeight: 800,
                fontSize: "0.9rem",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <section style={{ marginTop: "1rem" }}>{children}</section>
      </main>
    </div>
  );
}

const PORTAL_VIEWS = [
  {
    id: "quick-entry",
    eyebrow: "Daily work",
    title: "Quick Entry",
    description: "Find learners and record term payments.",
  },
  {
    id: "settings",
    eyebrow: "Personal account",
    title: "Settings",
    description: "Manage your profile photo and password.",
  },
  {
    id: "audit",
    eyebrow: "Account history",
    title: "Audit",
    description: "Review sign-ins and saved financial actions.",
  },
];

export default function AccountsPortalNav({ activeView, canAudit, canUseSettings, onChange }) {
  const visibleViews = PORTAL_VIEWS.filter((view) => {
    if (view.id === "audit") return canAudit;
    if (view.id === "settings") return canUseSettings;
    return true;
  });

  return (
    <nav className="accounts-portal-nav" aria-label="SPESS Accounts sections">
      {visibleViews.map((view, index) => {
        const active = activeView === view.id;
        return (
          <button
            key={view.id}
            type="button"
            className={`accounts-portal-card ${active ? "is-active" : ""}`}
            aria-expanded={active}
            aria-controls={`accounts-${view.id}-panel`}
            onClick={() => onChange(active ? null : view.id)}
          >
            <span className="accounts-portal-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="accounts-portal-copy">
              <small>{view.eyebrow}</small>
              <strong>{view.title}</strong>
              <span>{view.description}</span>
            </span>
            <span className="accounts-portal-arrow" aria-hidden="true">{active ? "−" : "+"}</span>
          </button>
        );
      })}
    </nav>
  );
}

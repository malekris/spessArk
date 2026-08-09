import { useMemo } from "react";

export default function SystemReadinessCard({
  calendarStatus,
  learnerCount = 0,
  oLevelAssignmentCount = 0,
  aLevelAssignmentCount = 0,
  backupStatus = {},
  backupError = "",
  maintenanceEnabled = false,
  dashboardLoading = false,
  dashboardError = "",
}) {
  const readiness = useMemo(() => {
    // These checks deliberately verify configuration and data availability,
    // not learner performance. A low assessment score must never make the
    // application itself look unhealthy.
    const checks = [
      {
        label: "Calendar published",
        detail: calendarStatus || "Unknown",
        passed: Boolean(calendarStatus && calendarStatus !== "Outside Published Calendar"),
      },
      {
        label: "Learner register loaded",
        detail: `${learnerCount} active`,
        passed: learnerCount > 0,
      },
      {
        label: "Teaching assignments",
        detail: `${oLevelAssignmentCount} O-Level · ${aLevelAssignmentCount} A-Level`,
        passed: oLevelAssignmentCount > 0 && aLevelAssignmentCount > 0,
      },
      {
        label: "Backup path protected",
        detail: backupError
          ? "Status unavailable"
          : backupStatus.backgroundJobEnabled
            ? "Scheduled worker"
            : "Resilient manual mode",
        passed:
          !backupError &&
          !backupStatus.dashboardDownloadEnabled &&
          backupStatus.approvedMethod === "resilient-cli",
      },
      {
        label: "Dashboard data source",
        detail: dashboardLoading ? "Refreshing" : dashboardError ? "Load warning" : "Available",
        passed: !dashboardError,
      },
      {
        label: "Teacher login gate",
        detail: maintenanceEnabled ? "Maintenance active" : "Open",
        passed: !maintenanceEnabled,
        warningOnly: maintenanceEnabled,
      },
    ];
    const passed = checks.filter((check) => check.passed).length;
    const percent = Math.round((passed / checks.length) * 100);
    const criticalFailure = checks.some((check) => !check.passed && !check.warningOnly);
    const label = maintenanceEnabled ? "Restricted" : criticalFailure ? "Attention" : "Ready";

    return { checks, passed, percent, label };
  }, [
    aLevelAssignmentCount,
    backupError,
    backupStatus,
    calendarStatus,
    dashboardError,
    dashboardLoading,
    learnerCount,
    maintenanceEnabled,
    oLevelAssignmentCount,
  ]);

  return (
    <article className="admin-pulse-card admin-pulse-card-system">
      <header className="admin-pulse-card-header">
        <div>
          <h3>System Readiness</h3>
          <p>A read-only preflight check across the dashboard’s core services.</p>
        </div>
        <span className="admin-pulse-badge">{readiness.label}</span>
      </header>

      <div className="admin-pulse-primary">
        <strong>{readiness.percent}%</strong>
        <span>{readiness.passed} of {readiness.checks.length} checks passing</span>
      </div>
      <div className="admin-pulse-progress" aria-label={`${readiness.percent}% system readiness`}>
        <span style={{ width: `${readiness.percent}%` }} />
      </div>

      <div className="admin-pulse-list">
        {readiness.checks.slice(0, 4).map((check) => (
          <div className="admin-pulse-row admin-pulse-check-row" key={check.label}>
            <span
              className={`admin-pulse-status-dot ${
                check.passed ? "" : check.warningOnly ? "is-warning" : "is-danger"
              }`}
              aria-hidden="true"
            />
            <div>
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </div>
            <span className="admin-pulse-row-value">{check.passed ? "OK" : "Check"}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

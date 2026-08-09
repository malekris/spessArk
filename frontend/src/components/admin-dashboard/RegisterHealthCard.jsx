import { useMemo } from "react";
import { parseLearnerSubjects } from "./dashboardCardUtils";

const hasUsableDate = (value) => {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
};

export default function RegisterHealthCard({
  oLevelLearners = [],
  aLevelLearners = [],
  academicYear,
  onReviewLearners,
}) {
  const health = useMemo(() => {
    // Only profile fields shared by both school levels are checked here. This
    // avoids false alarms from level-specific fields such as A-Level houses.
    const records = [
      ...oLevelLearners.map((learner) => ({ ...learner, level: "O-Level" })),
      ...aLevelLearners.map((learner) => ({ ...learner, level: "A-Level" })),
    ];
    const issueCounts = {
      "Missing student name": 0,
      "Missing or invalid DOB": 0,
      "Missing gender": 0,
      "Missing class or stream": 0,
      "No registered subjects": 0,
    };
    let affectedLearners = 0;

    records.forEach((learner) => {
      const learnerIssues = [];
      const name = String(learner.name || `${learner.first_name || ""} ${learner.last_name || ""}`).trim();
      const stream = String(learner.stream || "").trim();
      const classLevel = String(learner.class_level || "").trim();
      const gender = String(learner.gender || "").trim().toLowerCase();

      if (!name) learnerIssues.push("Missing student name");
      if (!hasUsableDate(learner.dob)) learnerIssues.push("Missing or invalid DOB");
      if (!["male", "female"].includes(gender)) learnerIssues.push("Missing gender");
      if (!stream || (learner.level === "O-Level" && !classLevel)) learnerIssues.push("Missing class or stream");
      if (parseLearnerSubjects(learner.subjects).length === 0) learnerIssues.push("No registered subjects");

      if (learnerIssues.length > 0) affectedLearners += 1;
      learnerIssues.forEach((issue) => {
        issueCounts[issue] += 1;
      });
    });

    const totalLearners = records.length;
    const healthyLearners = Math.max(0, totalLearners - affectedLearners);
    const score = totalLearners ? Math.round((healthyLearners / totalLearners) * 100) : 0;
    const issues = Object.entries(issueCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    return { totalLearners, healthyLearners, affectedLearners, score, issues };
  }, [aLevelLearners, oLevelLearners]);

  const status = health.score >= 95 ? "Healthy" : health.score >= 80 ? "Review" : "Attention";

  return (
    <article className="admin-pulse-card admin-pulse-card-register">
      <header className="admin-pulse-card-header">
        <div>
          <h3>Register Health</h3>
          <p>Profile completeness across active O-Level and A-Level learners.</p>
        </div>
        <span className="admin-pulse-badge">{status}</span>
      </header>

      <div className="admin-pulse-primary">
        <strong>{health.score}%</strong>
        <span>complete profiles in {academicYear}</span>
      </div>
      <div className="admin-pulse-progress" aria-label={`${health.score}% register health`}>
        <span style={{ width: `${health.score}%` }} />
      </div>

      {health.issues.length ? (
        <div className="admin-pulse-list">
          {health.issues.slice(0, 3).map(([label, count]) => (
            <div className="admin-pulse-row" key={label}>
              <div>
                <strong>{label}</strong>
                <small>{count === 1 ? "1 learner affected" : `${count} learners affected`}</small>
              </div>
              <span className="admin-pulse-row-value">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-pulse-empty">
          All {health.totalLearners} active learner profiles contain the core registration fields.
        </div>
      )}

      <button type="button" className="admin-pulse-card-action" onClick={onReviewLearners}>
        Review learner register
      </button>
    </article>
  );
}


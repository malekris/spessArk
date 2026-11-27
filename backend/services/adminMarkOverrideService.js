const EDITABLE_COMPONENTS = new Set(["AOI1", "AOI2", "AOI3", "EXAM80"]);

export const normalizeAdminMarkOverride = ({ component, status, score }) => {
  const normalizedComponent = String(component || "").trim().toUpperCase();
  if (!EDITABLE_COMPONENTS.has(normalizedComponent)) {
    throw new Error("This assessment component cannot be overridden.");
  }

  const normalizedStatus = String(status || "Present").trim().toLowerCase();
  if (!new Set(["present", "missed"]).has(normalizedStatus)) {
    throw new Error("Status must be Present or Missed.");
  }

  if (normalizedStatus === "missed") {
    return {
      component: normalizedComponent,
      score: null,
      status: "Missed",
    };
  }

  if (score === "" || score === null || score === undefined) {
    throw new Error("Enter a score or mark the learner as Missed.");
  }

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) {
    throw new Error("Enter a valid numeric score.");
  }

  if (normalizedComponent === "EXAM80" && (numericScore < 0 || numericScore > 80)) {
    throw new Error("/80 score must be between 0 and 80.");
  }

  if (normalizedComponent !== "EXAM80" && (numericScore < 0.9 || numericScore > 3)) {
    throw new Error("AOI score must be between 0.9 and 3.0.");
  }

  return {
    component: normalizedComponent,
    score: numericScore,
    status: "Present",
  };
};

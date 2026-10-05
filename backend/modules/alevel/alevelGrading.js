export const PRINCIPAL_GRADE_BANDS = Object.freeze([
  Object.freeze({ grade: "A", indicator: "Exceptional", minimum: 79.5, maximum: 100, points: 5 }),
  Object.freeze({ grade: "B", indicator: "Outstanding", minimum: 69.5, maximum: 79.4, points: 4 }),
  Object.freeze({ grade: "C", indicator: "Satisfactory", minimum: 59.5, maximum: 69.4, points: 3 }),
  Object.freeze({ grade: "D", indicator: "Basic", minimum: 49.5, maximum: 59.4, points: 2 }),
  Object.freeze({ grade: "E", indicator: "Elementary", minimum: 0, maximum: 49.4, points: 1 }),
]);

export const SUBSIDIARY_GRADE_BANDS = Object.freeze([
  Object.freeze({ grade: "P", indicator: "Pass", minimum: 50, maximum: 100, points: 1 }),
  Object.freeze({ grade: "F", indicator: "Fail", minimum: 0, maximum: 49.9, points: 0 }),
]);  

export function averageAlevelScores(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const scores = values.map((value) => {
    if (value === null || value === undefined || value === "") return null;
    const score = Number(value);
    return Number.isFinite(score) ? score : null;
  });

  if (scores.some((score) => score === null)) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
}

export function gradePrincipalAverage(value) {
  if (value === null || value === undefined || value === "") return null;
  const average = Number(value);
  if (!Number.isFinite(average)) return null;

  const band = PRINCIPAL_GRADE_BANDS.find(({ minimum }) => average >= minimum);
  return band ? { ...band, average } : null;
}

export function gradeSubsidiaryAverage(value) {
  if (value === null || value === undefined || value === "") return null;
  const average = Number(value);
  if (!Number.isFinite(average)) return null;

  const band = average >= 50 ? SUBSIDIARY_GRADE_BANDS[0] : SUBSIDIARY_GRADE_BANDS[1];
  return { ...band, average };
}

export const formatNoticeboardSubmissionMark = (mark) => {
  if (!mark) return "";
  if (String(mark.status || "").trim().toLowerCase() === "missed") return "X";
  if (mark.score === null || mark.score === undefined || mark.score === "") return "";
  return "S";
};

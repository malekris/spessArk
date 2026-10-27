const FINAL_SUBMISSION_STATUSES = new Set(["graded", "needs_revision", "missing"]);

export const isSubmissionFinalized = (submission = {}) =>
  submission.graded_at !== null && submission.graded_at !== undefined ||
  submission.score !== null && submission.score !== undefined ||
  FINAL_SUBMISSION_STATUSES.has(String(submission.status || "").trim().toLowerCase());

export const sanitizeSubmissionFilename = (value, fallback = "submitted-file") => {
  const basename = String(value || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const safeFallback = String(fallback || "submitted-file").trim() || "submitted-file";
  return (basename || safeFallback).slice(0, 255);
};

export const buildAttachmentContentDisposition = (filename) => {
  const safeName = sanitizeSubmissionFilename(filename);
  const asciiName = safeName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
};


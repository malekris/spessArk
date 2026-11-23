import crypto from "node:crypto";

export const ACCOUNTS_CLASSES = ["S1", "S2", "S3", "S4", "S5", "S6"];
export const ACCOUNTS_TERMS = ["Term 1", "Term 2", "Term 3"];
export const ACCOUNTS_RESIDENCE_TYPES = ["Day", "Boarding"];

export const normalizeAccountsClass = (value = "") =>
  String(value || "").trim().toUpperCase();

export const normalizeAccountsTerm = (value = "") => {
  const term = String(value || "").trim();
  return ACCOUNTS_TERMS.includes(term) ? term : "";
};

export const normalizeResidenceType = (value = "") => {
  const match = ACCOUNTS_RESIDENCE_TYPES.find(
    (item) => item.toLowerCase() === String(value || "").trim().toLowerCase()
  );
  return match || "";
};

export const normalizeAccountsEmail = (value = "") =>
  String(value || "").trim().toLowerCase();

export const isValidAccountsEmail = (value = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAccountsEmail(value));

export const isValidAccountsPassword = (value = "") => String(value || "").length >= 12;

export const parseMoneyAmount = (value, { nullable = false } = {}) => {
  if (nullable && (value === "" || value === null || value === undefined)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999.99) return null;
  return Number(amount.toFixed(2));
};

export const buildPaymentTransaction = (previousAmount, nextAmount) => {
  const previous = previousAmount === null || previousAmount === undefined
    ? null
    : Number(previousAmount);
  const next = nextAmount === null || nextAmount === undefined
    ? null
    : Number(nextAmount);

  if (previous === next || (previous === null && next === null)) return null;

  if (next === null) {
    return { type: "payment_cleared", amountChange: -Number(previous || 0) };
  }
  if (previous === null && next === 0) {
    return { type: "not_paid", amountChange: 0 };
  }

  const amountChange = Number((next - Number(previous || 0)).toFixed(2));
  return {
    type: amountChange >= 0 ? "payment_added" : "payment_corrected",
    amountChange,
  };
};

const getUpdateStatus = (updated, total) => {
  if (!updated) return "untouched";
  return updated >= total ? "complete" : "in_progress";
};

export const buildFeesUpdateTracker = (rows = []) => {
  const classesByName = new Map();

  for (const row of rows) {
    const classLevel = normalizeAccountsClass(row?.class_level);
    const streamName = String(row?.stream || "").trim();
    if (!classLevel || !streamName) continue;

    if (!classesByName.has(classLevel)) {
      classesByName.set(classLevel, {
        class_level: classLevel,
        total_learners: 0,
        updated_learners: 0,
        streams: new Map(),
      });
    }
    const classGroup = classesByName.get(classLevel);

    if (!classGroup.streams.has(streamName)) {
      classGroup.streams.set(streamName, {
        stream: streamName,
        total_learners: 0,
        updated_learners: 0,
        learners: [],
      });
    }
    const streamGroup = classGroup.streams.get(streamName);
    const updated = Boolean(Number(row?.is_updated));
    const learner = {
      learner_level: row?.learner_level,
      learner_id: Number(row?.learner_id),
      learner_name: String(row?.learner_name || "").trim(),
      updated,
      amount_paid: updated ? Number(row?.amount_paid || 0) : null,
      updated_by: updated ? row?.updated_by || null : null,
      updated_at: updated ? row?.updated_at || null : null,
    };

    streamGroup.learners.push(learner);
    streamGroup.total_learners += 1;
    classGroup.total_learners += 1;
    if (updated) {
      streamGroup.updated_learners += 1;
      classGroup.updated_learners += 1;
    }
  }

  const classes = ACCOUNTS_CLASSES
    .map((classLevel) => classesByName.get(classLevel))
    .filter(Boolean)
    .map((classGroup) => {
      const streams = Array.from(classGroup.streams.values()).map((stream) => ({
        ...stream,
        untouched_learners: stream.total_learners - stream.updated_learners,
        completion_percent: stream.total_learners
          ? Math.round((stream.updated_learners / stream.total_learners) * 100)
          : 0,
        status: getUpdateStatus(stream.updated_learners, stream.total_learners),
      }));
      return {
        class_level: classGroup.class_level,
        total_learners: classGroup.total_learners,
        updated_learners: classGroup.updated_learners,
        untouched_learners: classGroup.total_learners - classGroup.updated_learners,
        completion_percent: classGroup.total_learners
          ? Math.round((classGroup.updated_learners / classGroup.total_learners) * 100)
          : 0,
        status: getUpdateStatus(classGroup.updated_learners, classGroup.total_learners),
        streams,
      };
    });

  const summary = classes.reduce((result, classGroup) => {
    result.total_learners += classGroup.total_learners;
    result.updated_learners += classGroup.updated_learners;
    result.untouched_learners += classGroup.untouched_learners;
    result[`${classGroup.status}_classes`] += 1;
    return result;
  }, {
    total_classes: classes.length,
    complete_classes: 0,
    in_progress_classes: 0,
    untouched_classes: 0,
    total_learners: 0,
    updated_learners: 0,
    untouched_learners: 0,
  });

  summary.completion_percent = summary.total_learners
    ? Math.round((summary.updated_learners / summary.total_learners) * 100)
    : 0;

  return { classes, summary };
};

export const safeCredentialEquals = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

export const getLearnerLevelForClass = (classLevel) =>
  ["S5", "S6"].includes(normalizeAccountsClass(classLevel)) ? "A_LEVEL" : "O_LEVEL";

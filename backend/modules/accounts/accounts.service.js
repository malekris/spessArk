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

export const safeCredentialEquals = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

export const getLearnerLevelForClass = (classLevel) =>
  ["S5", "S6"].includes(normalizeAccountsClass(classLevel)) ? "A_LEVEL" : "O_LEVEL";

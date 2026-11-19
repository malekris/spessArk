export const normalizeMoneyInput = (value) => {
  const integerPart = String(value ?? "")
    .replaceAll(",", "")
    .split(".")[0];
  const digits = integerPart.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
};

export const formatMoneyInput = (value) => {
  const normalized = normalizeMoneyInput(value);
  if (!normalized) return "";
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

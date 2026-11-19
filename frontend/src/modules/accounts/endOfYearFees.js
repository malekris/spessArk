export const DAY_TERM_FEE = 130_000;
export const BOARDING_TERM_FEE = 380_000;
export const DAY_FEE_BANDS = Object.freeze({
  lunch: 70_000,
  development: 40_000,
  church: 20_000,
});

const toNonNegativeAmount = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

export const normalizeAccountsResidence = (value) =>
  String(value || "").trim().toLowerCase() === "boarding" ? "BOARDING" : "DAY";

// Reports use parent-facing section names while Accounts keeps its existing
// DAY/BOARDING values for fee calculations and stored records.
export const formatAccountsSection = (value) =>
  normalizeAccountsResidence(value) === "BOARDING" ? "Hostel" : "Day";

export const getEndOfYearFeeSummary = ({ residenceType, amountPaid } = {}) => {
  const residence = normalizeAccountsResidence(residenceType);
  const paid = toNonNegativeAmount(amountPaid);
  const paymentRecorded = amountPaid !== null && amountPaid !== undefined && amountPaid !== "";

  if (residence === "BOARDING") {
    return {
      residence,
      termFee: BOARDING_TERM_FEE,
      paid,
      paymentRecorded,
      balance: Math.max(0, BOARDING_TERM_FEE - paid),
      lunchPaid: 0,
      developmentPaid: 0,
      churchPaid: 0,
    };
  }

  const lunchPaid = Math.min(paid, DAY_FEE_BANDS.lunch);
  const developmentPaid = Math.min(
    Math.max(0, paid - DAY_FEE_BANDS.lunch),
    DAY_FEE_BANDS.development
  );
  const churchPaid = Math.min(
    Math.max(0, paid - DAY_FEE_BANDS.lunch - DAY_FEE_BANDS.development),
    DAY_FEE_BANDS.church
  );

  return {
    residence,
    termFee: DAY_TERM_FEE,
    paid,
    paymentRecorded,
    balance: Math.max(0, DAY_TERM_FEE - paid),
    lunchPaid,
    developmentPaid,
    churchPaid,
  };
};

const feeNumberFormatter = new Intl.NumberFormat("en-UG", {
  maximumFractionDigits: 0,
});

export const formatReportFeeAmount = (value) =>
  `${feeNumberFormatter.format(Number(value || 0))}/=`;

const formatContributionTerm = (term) => {
  const rawTerm = String(term || "").trim();
  if (!rawTerm) return "";

  const numericTerm = rawTerm.match(/^(?:term\s*)?(\d+)$/i);
  return numericTerm ? `Term ${numericTerm[1]}` : rawTerm;
};

export const buildFeeContributionTitle = ({ term, year } = {}) => {
  const period = [formatContributionTerm(term), String(year || "").trim()]
    .filter(Boolean)
    .join(" ");
  const periodLabel = period ? ` (${period})` : "";

  return `FEES CONTRIBUTIONS${periodLabel}`;
};

export const buildEndOfYearFeeCells = (summary) => {
  const balanceValue =
    Number(summary?.balance || 0) === 0
      ? "Nil"
      : formatReportFeeAmount(summary?.balance);

  if (summary?.residence === "BOARDING") {
    return [
      `Section: ${formatAccountsSection(summary.residence)}`,
      `Term Fee: ${formatReportFeeAmount(summary.termFee)}`,
      `Paid: ${summary.paid > 0 ? formatReportFeeAmount(summary.paid) : ""}`,
      `Balance: ${balanceValue}`,
    ];
  }

  const contributionValue = (value) =>
    value > 0 ? formatReportFeeAmount(value) : "Not Paid";

  return [
    `Lunch Fee: ${contributionValue(summary?.lunchPaid)}`,
    `Development Fee: ${contributionValue(summary?.developmentPaid)}`,
    `Church Fee: ${contributionValue(summary?.churchPaid)}`,
    `Balance: ${balanceValue}`,
  ];
};

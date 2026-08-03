export const ALEVEL_ACTIVE_STATUS = "active";
export const ALEVEL_ARCHIVED_STATUS = "archived";

export const ALEVEL_PROMOTION_STREAMS = Object.freeze([
  "S5 Arts",
  "S5 Sciences",
  "S6 Arts",
  "S6 Sciences",
]);

export function normalizeAlevelStream(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const match = ALEVEL_PROMOTION_STREAMS.find(
    (stream) => stream.toLowerCase() === raw
  );
  return match || "";
}

export function getAlevelPromotionTarget(stream) {
  const normalizedStream = normalizeAlevelStream(stream);
  if (!normalizedStream) return null;

  if (normalizedStream.startsWith("S5 ")) {
    return {
      fromStream: normalizedStream,
      toStream: normalizedStream.replace(/^S5 /, "S6 "),
      promotionType: "PROMOTED",
      nextStatus: ALEVEL_ACTIVE_STATUS,
    };
  }

  return {
    fromStream: normalizedStream,
    toStream: normalizedStream,
    promotionType: "GRADUATED",
    nextStatus: ALEVEL_ARCHIVED_STATUS,
  };
}

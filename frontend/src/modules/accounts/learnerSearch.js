export const normalizeLearnerSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const appearsInOrder = (needle, haystack) => {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
};

export const matchesLearnerSearch = (learnerName, rawQuery) => {
  const query = normalizeLearnerSearchText(rawQuery);
  if (!query) return true;

  const normalizedName = normalizeLearnerSearchText(learnerName);
  const nameParts = normalizedName.split(" ").filter(Boolean);
  const queryParts = query.split(" ").filter(Boolean);

  return queryParts.every((queryPart) => {
    if (normalizedName.includes(queryPart)) return true;
    return nameParts.some((namePart) => (
      namePart.startsWith(queryPart) ||
      (
        queryPart.length >= 2 &&
        namePart.startsWith(queryPart[0]) &&
        appearsInOrder(queryPart, namePart)
      )
    ));
  });
};

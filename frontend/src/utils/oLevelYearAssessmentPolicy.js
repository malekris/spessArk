export const EMERGENCY_TWO_AOI_YEAR_MODE = "EMERGENCY_TWO_TERM3_AOIS";
export const EMERGENCY_TWO_AOI_ACADEMIC_YEAR = 2026;

export const usesEmergencyTwoAoiAcademicYear = (academicYear) =>
  Number(academicYear) === EMERGENCY_TWO_AOI_ACADEMIC_YEAR;

export const usesEmergencyTwoAoiYearModel = (row) =>
  String(row?.year_assessment_model || "").trim().toUpperCase() === EMERGENCY_TWO_AOI_YEAR_MODE;

export const getOLevelMarkEntryColumns = (term, academicYear) => {
  if (String(term || "").trim() !== "Term 3") {
    return ["AOI1", "AOI2", "AOI3"];
  }

  return usesEmergencyTwoAoiAcademicYear(academicYear)
    ? ["AOI1", "AOI2", "EXAM80"]
    : ["AOI1", "AOI2", "AOI3", "EXAM80"];
};

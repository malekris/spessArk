import { adminFetch } from "../lib/api";

export async function recordAdminReportGeneration(payload) {
  try {
    await adminFetch("/api/admin/audit-logs/report-generation", {
      method: "POST",
      body: payload,
    });
    return true;
  } catch (err) {
    console.error("Report generation audit event failed:", err);
    return false;
  }
}

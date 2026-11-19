import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/security.js";

export default function authAccountsAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Accounts authorization required" });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (!["accounts_admin", "accounts_owner", "accounts_bursar"].includes(payload?.role)) {
      return res.status(403).json({ message: "Accounts authorization required" });
    }
    req.accountsAdmin = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired Accounts session" });
  }
}

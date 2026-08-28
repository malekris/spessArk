import jwt from "jsonwebtoken";
import { ensureParentPortalSchemaReady } from "../services/parentPortalService.js";

export function signParentSessionToken(parent) {
  return jwt.sign(
    {
      id: Number(parent.id),
      phone: parent.phone_e164,
      name: parent.display_name,
      role: "parent",
    },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "12h" }
  );
}

export default function createParentAuth(connection) {
  return async function authParent(req, res, next) {
    const authorization = String(req.headers.authorization || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

    if (!token) {
      return res.status(401).json({ code: "PARENT_AUTH_REQUIRED", message: "Parent sign-in is required." });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
      if (decoded?.role !== "parent" || !decoded?.id) throw new Error("Invalid parent token");

      await ensureParentPortalSchemaReady(connection);
      const [[parent]] = await connection.query(
        `SELECT id, display_name, phone_e164, status
         FROM spess_parent_accounts
         WHERE id = ?
         LIMIT 1`,
        [decoded.id]
      );

      if (!parent || parent.status !== "active") {
        return res.status(403).json({
          code: "PARENT_ACCOUNT_INACTIVE",
          message: "This parent account is not currently active.",
        });
      }

      req.parent = parent;
      return next();
    } catch {
      return res.status(401).json({ code: "PARENT_SESSION_INVALID", message: "Parent session expired. Please sign in again." });
    }
  };
}

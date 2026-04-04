import jwt from "jsonwebtoken";

const ADMIN_JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// Keep admin security behavior consistent between localhost and production.
// If we ever need a bypass for emergency development work, it should be explicit.
const isAdminBypassEnabled = () => process.env.DISABLE_ADMIN_AUTH === "true";

const readBearerToken = (req) => {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

export function signAdminSessionToken(admin) {
  return jwt.sign(
    {
      id: Number(admin?.id) || 1,
      username: String(admin?.username || "admin").trim() || "admin",
      role: "admin",
      type: "admin_session",
    },
    ADMIN_JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export function signAdminReauthToken(admin) {
  return jwt.sign(
    {
      id: Number(admin?.id) || 1,
      username: String(admin?.username || "admin").trim() || "admin",
      role: "admin",
      type: "admin_reauth",
    },
    ADMIN_JWT_SECRET,
    { expiresIn: "10m" }
  );
}

export function verifyAdminToken(token) {
  return jwt.verify(String(token || "").trim(), ADMIN_JWT_SECRET);
}

export const requireAdminReauth = (req, res, next) => {
  try {
    if (isAdminBypassEnabled()) return next();

    const reauthToken = String(req.headers["x-admin-reauth"] || "").trim();
    if (!reauthToken) {
      return res.status(403).json({
        message: "Recent admin password confirmation is required for this action.",
        code: "ADMIN_REAUTH_REQUIRED",
      });
    }

    const decoded = verifyAdminToken(reauthToken);
    if (decoded?.role !== "admin" || decoded?.type !== "admin_reauth") {
      return res.status(403).json({
        message: "Recent admin password confirmation is required for this action.",
        code: "ADMIN_REAUTH_REQUIRED",
      });
    }

    if (req.admin?.id && Number(decoded.id) !== Number(req.admin.id)) {
      return res.status(403).json({
        message: "Recent admin password confirmation is required for this action.",
        code: "ADMIN_REAUTH_REQUIRED",
      });
    }

    req.adminReauth = decoded;
    return next();
  } catch (err) {
    return res.status(403).json({
      message: "Recent admin password confirmation is required for this action.",
      code: "ADMIN_REAUTH_REQUIRED",
    });
  }
};

const authAdmin = (req, res, next) => {
  try {
    if (isAdminBypassEnabled()) {
      req.admin = { id: 1, username: "admin", role: "admin", authMethod: "dev-bypass" };
      return next();
    }

    const bearerToken = readBearerToken(req);
    if (bearerToken) {
      const decoded = verifyAdminToken(bearerToken);
      if (decoded?.role === "admin" && decoded?.type === "admin_session") {
        req.admin = decoded;
        return next();
      }
    }

    const key = String(req.headers["x-admin-key"] || "").trim();
    const expected = String(process.env.ADMIN_KEY || "").trim();

    if (key && expected && key === expected) {
      req.admin = {
        id: 1,
        username: String(process.env.ADMIN_USERNAME || "admin").trim() || "admin",
        role: "admin",
        authMethod: "legacy-key",
      };
      return next();
    }

    return res.status(401).json({ message: "Admin auth required" });
  } catch (err) {
    console.error("authAdmin error:", err);
    return res.status(401).json({ message: "Admin auth required" });
  }
};

export default authAdmin;

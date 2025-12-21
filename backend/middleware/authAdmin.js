const authAdmin = (req, res, next) => {
  try {
    // ✅ Allow bypass in development
    const devBypass =
      process.env.DISABLE_ADMIN_AUTH === "true" ||
      process.env.NODE_ENV !== "production";

    if (devBypass) return next();

    // 🔐 Production admin key check
    const key = (req.headers["x-admin-key"] || "").trim();
    const expected = process.env.ADMIN_KEY || "";

    if (key && expected && key === expected) {
      return next();
    }

    return res.status(401).json({ message: "Admin auth required" });
  } catch (err) {
    console.error("authAdmin error:", err);
    return res.status(401).json({ message: "Admin auth required" });
  }
};

export default authAdmin;

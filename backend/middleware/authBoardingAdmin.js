import jwt from "jsonwebtoken";

export default function authBoardingAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Boarding admin authorization required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
    if (payload?.role !== "boarding_admin") {
      return res.status(403).json({ message: "Boarding admin authorization required" });
    }
    req.boardingAdmin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired boarding admin token" });
  }
}

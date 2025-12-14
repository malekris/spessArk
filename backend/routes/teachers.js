import express from "express";
import bcrypt from "bcryptjs";

const router = express.Router();

// TEMP in-memory check (replace with DB query)
const fakeTeachers = []; // remove later

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    // Example duplicate check
    const exists = fakeTeachers.find((t) => t.email === email);
    if (exists) {
      return res.status(409).json({
        message: "Teacher already registered",
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    fakeTeachers.push({
      name,
      email,
      password: hashed,
      verified: false,
    });

    return res.json({
      message:
        "Account created successfully. Please check your email for verification.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;

import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: ["../.env.local", "../.env"].map((path) => fileURLToPath(new URL(path, import.meta.url))),
});

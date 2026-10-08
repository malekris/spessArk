import test from "node:test";
import assert from "node:assert/strict";
import { getLibrarySupportFileType } from "./vineCommunityLibraryRoutes.js";

test("accepts Windows-friendly compressed support files", () => {
  assert.equal(getLibrarySupportFileType({ originalname: "lesson-pack.zip" })?.extension, "zip");
  assert.equal(getLibrarySupportFileType({ originalname: "database assets.7z" })?.extension, "7z");
  assert.equal(getLibrarySupportFileType({ originalname: "templates.RAR" })?.extension, "rar");
});

test("rejects executable and document files from the support shelf", () => {
  assert.equal(getLibrarySupportFileType({ originalname: "setup.exe" }), null);
  assert.equal(getLibrarySupportFileType({ originalname: "notes.pdf" }), null);
  assert.equal(getLibrarySupportFileType({ originalname: "archive.zip.exe" }), null);
});

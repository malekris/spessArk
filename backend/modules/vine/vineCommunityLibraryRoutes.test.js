import test from "node:test";
import assert from "node:assert/strict";
import {
  getLibrarySupportFileType,
  normalizeLibraryFolderPath,
} from "./vineCommunityLibraryRoutes.js";

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

test("normalizes library folder paths before storing them", () => {
  assert.equal(
    normalizeLibraryFolderPath(" /Senior Five//Physics/../Term 1/ "),
    "Senior Five/Physics/Term 1"
  );
  assert.equal(normalizeLibraryFolderPath("../../"), "");
});

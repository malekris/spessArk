import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLibraryFolderUploadEntries,
  getLibraryFolderPaths,
  getLibraryFolderView,
  normalizeLibraryFolderPath,
} from "./libraryFolders.js";

test("normalizes folder paths without allowing traversal segments", () => {
  assert.equal(
    normalizeLibraryFolderPath(" /Physics//Term 1/../Revision/ "),
    "Physics/Term 1/Revision"
  );
});

test("keeps legacy documents in the root and exposes immediate child folders", () => {
  const items = [
    { id: 1, title: "Welcome" },
    { id: 2, title: "Motion", folder_path: "Physics/Term 1" },
    { id: 3, title: "Waves", folder_path: "Physics/Term 2" },
  ];

  assert.deepEqual(getLibraryFolderPaths(items), ["Physics", "Physics/Term 1", "Physics/Term 2"]);
  assert.deepEqual(getLibraryFolderView(items, "").directFiles.map((item) => item.id), [1]);
  assert.deepEqual(getLibraryFolderView(items, "").childFolders, [
    { name: "Physics", path: "Physics", documentCount: 2 },
  ]);
});

test("preserves a selected folder hierarchy below the active destination", () => {
  const file = { name: "Notes.pdf", webkitRelativePath: "Revision/Week 1/Notes.pdf" };
  const [entry] = buildLibraryFolderUploadEntries([file], "Senior Two");

  assert.equal(entry.folderPath, "Senior Two/Revision/Week 1");
  assert.equal(entry.title, "Notes");
  assert.equal(entry.file, file);
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createVineCommunityAssignmentsRouter from "./vineCommunityAssignmentsRoutes.js";

test("community owner downloads all practical files in a learner-named ZIP", async (t) => {
  let baseUrl = "";
  const db = {
    query: async (sql) => {
      if (sql.includes("JOIN vine_users u") && sql.includes("JOIN vine_community_assignments a")) {
        return [[{
          id: 21,
          attachment_url: null,
          attachment_name: null,
          attachment_mime: null,
          username: "sara.t",
          display_name: "Sara Tancredi",
          assignment_type: "practical",
        }]];
      }
      if (sql.includes("FROM vine_community_submission_files")) {
        return [[
          { file_url: `${baseUrl}/stored/one`, file_name: "Practical.xlsx", file_mime: "application/octet-stream" },
          { file_url: `${baseUrl}/stored/two`, file_name: "Practical.xlsx", file_mime: "application/octet-stream" },
        ]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const uploadMiddleware = (_req, _res, next) => next();
  const app = express();
  app.get("/stored/one", (_req, res) => res.send(Buffer.from("first-file")));
  app.get("/stored/two", (_req, res) => res.send(Buffer.from("second-file")));
  app.use("/api/vine", createVineCommunityAssignmentsRouter({
    db,
    authenticate: (req, _res, next) => { req.user = { id: 7 }; next(); },
    uploadPostCloudinary: {
      single: () => uploadMiddleware,
      array: () => uploadMiddleware,
    },
    ensureCommunitySchema: async () => {},
    ensureVinePerformanceSchema: async () => {},
    getCommunityRole: async () => "owner",
    isCommunityModOrOwner: () => true,
    isStoredSubmissionUrl: (url) => url.startsWith(baseUrl),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(
    `${baseUrl}/api/vine/communities/4/assignments/9/submissions/21/files/archive`
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/zip/);
  assert.match(response.headers.get("content-disposition") || "", /Sara%20Tancredi\.zip/);

  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(archive.subarray(0, 2).toString(), "PK");
  assert.equal(archive.includes(Buffer.from("Practical.xlsx")), true);
  assert.equal(archive.includes(Buffer.from("Practical (2).xlsx")), true);
});

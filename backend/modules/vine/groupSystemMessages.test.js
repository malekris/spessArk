import assert from "node:assert/strict";
import test from "node:test";
import { formatGroupMembersAdded } from "./groupSystemMessages.js";

test("names the person added by their username", () => {
  assert.equal(formatGroupMembersAdded(["kangibrown"]), "@kangibrown was added");
});

test("names every person in a multi-member addition", () => {
  assert.equal(formatGroupMembersAdded(["kangibrown", "sarah_nambi"]), "@kangibrown and @sarah_nambi were added");
  assert.equal(formatGroupMembersAdded(["kangibrown", "sarah_nambi", "brian"]), "@kangibrown, @sarah_nambi, and @brian were added");
});

test("does not repeat the same person", () => {
  assert.equal(formatGroupMembersAdded(["kangibrown", "kangibrown"]), "@kangibrown was added");
});

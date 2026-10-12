import test from "node:test";
import assert from "node:assert/strict";
import {
  NEW_PROFILE_PICTURE_HASHTAG,
  NEW_PROFILE_PICTURE_TOPIC,
  buildProfilePicturePostPayload,
} from "./profilePicturePost.js";

test("builds a normal image post for a new profile picture", () => {
  const payload = buildProfilePicturePostPayload({
    avatarUrl: "https://cdn.example.com/avatar.jpg",
    clientRequestId: "profile-picture-request-1",
    postSourceLabel: "Mac",
  });

  assert.match(payload.content, new RegExp(`${NEW_PROFILE_PICTURE_HASHTAG}$`));
  assert.equal(payload.topicTag, NEW_PROFILE_PICTURE_TOPIC);
  assert.deepEqual(JSON.parse(payload.imageUrl), ["https://cdn.example.com/avatar.jpg"]);
  assert.equal(payload.clientRequestId, "profile-picture-request-1");
  assert.equal(payload.postSourceLabel, "Mac");
});

test("rejects a profile picture post without an image URL", () => {
  assert.throws(
    () => buildProfilePicturePostPayload({ avatarUrl: "  " }),
    /Profile picture URL is required/
  );
});

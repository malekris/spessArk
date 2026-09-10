import assert from "node:assert/strict";
import test from "node:test";
import { planCommunityGroupMembership } from "./communityGroupChat.js";

test("creates one owner and keeps every other community role as a group member", () => {
  const plan = planCommunityGroupMembership({
    ownerId: 10,
    creating: true,
    communityMembers: [
      { user_id: 10, role: "owner", username: "teacher" },
      { user_id: 11, role: "moderator", username: "class_mod" },
      { user_id: 12, role: "member", username: "learner" },
    ],
  });

  assert.deepEqual(
    plan.membersToAdd.map(({ user_id, group_role }) => ({ user_id, group_role })),
    [
      { user_id: 10, group_role: "owner" },
      { user_id: 11, group_role: "member" },
      { user_id: 12, group_role: "member" },
    ]
  );
  assert.deepEqual(plan.notificationRecipientIds, [11, 12]);
});

test("sync adds only missing members and removes people outside the community", () => {
  const plan = planCommunityGroupMembership({
    ownerId: 10,
    communityMembers: [
      { user_id: 10, role: "owner" },
      { user_id: 11, role: "moderator" },
      { user_id: 13, role: "member" },
    ],
    activeGroupMembers: [
      { user_id: 10, role: "owner" },
      { user_id: 11, role: "admin" },
      { user_id: 12, role: "member" },
    ],
  });

  assert.deepEqual(
    plan.membersToAdd.map(({ user_id, group_role }) => ({ user_id, group_role })),
    [{ user_id: 13, group_role: "member" }]
  );
  assert.deepEqual(plan.memberIdsToRemove, [12]);
  assert.deepEqual(plan.notificationRecipientIds, [13]);
});

test("deduplicates membership rows before planning a sync", () => {
  const plan = planCommunityGroupMembership({
    ownerId: 1,
    creating: true,
    communityMembers: [{ user_id: 1 }, { user_id: "1" }, { user_id: 2 }, { user_id: 2 }],
  });

  assert.deepEqual(plan.members.map((member) => member.user_id), [1, 2]);
  assert.deepEqual(plan.notificationRecipientIds, [2]);
});

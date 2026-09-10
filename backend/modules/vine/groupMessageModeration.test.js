import test from "node:test";
import assert from "node:assert/strict";
import { canDeleteConversationMessage } from "./groupMessageModeration.js";

test("lets people delete their own direct and group messages", () => {
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "direct" }, viewerId: 7, senderId: 7 }), true);
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "group", member_role: "member" }, viewerId: 7, senderId: 7 }), true);
});

test("lets group admins delete another member's message", () => {
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "group", member_role: "owner" }, viewerId: 7, senderId: 8 }), true);
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "group", member_role: "admin" }, viewerId: 7, senderId: 8 }), true);
});

test("does not let regular members or direct-chat participants delete someone else's message", () => {
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "group", member_role: "member" }, viewerId: 7, senderId: 8 }), false);
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "direct" }, viewerId: 7, senderId: 8 }), false);
});

test("keeps system notices protected from message deletion", () => {
  assert.equal(canDeleteConversationMessage({ conversation: { conversation_type: "group", member_role: "owner" }, viewerId: 7, senderId: 8, messageType: "system" }), false);
});

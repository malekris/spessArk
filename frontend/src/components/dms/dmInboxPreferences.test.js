import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DM_INBOX_PREFERENCES,
  normalizeDmInboxPreferences,
  orderInboxConversations,
} from "./dmInboxPreferences.js";

test("normalizes damaged or incomplete inbox preference values", () => {
  assert.deepEqual(normalizeDmInboxPreferences(null), DEFAULT_DM_INBOX_PREFERENCES);
  assert.deepEqual(
    normalizeDmInboxPreferences({
      density: "tiny",
      showMessagePreviews: 0,
      showOnlineIndicators: false,
      prioritizeUnread: "yes",
      enterToSend: false,
    }),
    {
      density: "comfortable",
      showMessagePreviews: true,
      showOnlineIndicators: false,
      prioritizeUnread: false,
      enterToSend: false,
    }
  );
});

test("unread-first ordering keeps pinned chats first and remains stable", () => {
  const conversations = [
    { conversation_id: 1, is_pinned: 0, unread_count: 0 },
    { conversation_id: 2, is_pinned: 1, unread_count: 0 },
    { conversation_id: 3, is_pinned: 0, unread_count: 4 },
    { conversation_id: 4, is_pinned: 0, unread_count: 1 },
  ];

  assert.deepEqual(
    orderInboxConversations(conversations, true).map((item) => item.conversation_id),
    [2, 3, 4, 1]
  );
  assert.equal(orderInboxConversations(conversations, false), conversations);
});

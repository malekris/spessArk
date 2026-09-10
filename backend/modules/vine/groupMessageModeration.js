const GROUP_MODERATOR_ROLES = new Set(["owner", "admin"]);

export const canDeleteConversationMessage = ({ conversation, viewerId, senderId, messageType }) => {
  if (!conversation || String(messageType || "text").toLowerCase() === "system") return false;
  if (Number(senderId) === Number(viewerId)) return true;
  return conversation.conversation_type === "group" && GROUP_MODERATOR_ROLES.has(conversation.member_role);
};

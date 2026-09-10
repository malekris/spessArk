const normalizeId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
};

const uniqueRowsByUserId = (rows) => {
  const unique = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const userId = normalizeId(row?.user_id);
    if (userId && !unique.has(userId)) unique.set(userId, { ...row, user_id: userId });
  });
  return [...unique.values()];
};

export function planCommunityGroupMembership({
  communityMembers = [],
  activeGroupMembers = [],
  ownerId,
  creating = false,
}) {
  const normalizedOwnerId = normalizeId(ownerId);
  const members = uniqueRowsByUserId(communityMembers);
  const activeMembers = uniqueRowsByUserId(activeGroupMembers);
  const communityIds = new Set(members.map((member) => member.user_id));
  const activeIds = new Set(activeMembers.map((member) => member.user_id));

  const membersToAdd = members
    .filter((member) => creating || !activeIds.has(member.user_id))
    .map((member) => ({
      ...member,
      group_role: member.user_id === normalizedOwnerId ? "owner" : "member",
    }));
  const memberIdsToRemove = creating
    ? []
    : activeMembers
        .map((member) => member.user_id)
        .filter((memberId) => !communityIds.has(memberId));

  return {
    members,
    membersToAdd,
    memberIdsToRemove,
    notificationRecipientIds: membersToAdd
      .map((member) => member.user_id)
      .filter((memberId) => memberId !== normalizedOwnerId),
  };
}

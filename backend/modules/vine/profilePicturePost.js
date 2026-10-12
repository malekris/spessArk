export const NEW_PROFILE_PICTURE_HASHTAG = "#NewProfilePic";
export const NEW_PROFILE_PICTURE_TOPIC = "newprofilepic";

export const buildProfilePicturePostPayload = ({
  avatarUrl,
  clientRequestId = null,
  postSourceLabel = null,
} = {}) => {
  const normalizedAvatarUrl = String(avatarUrl || "").trim();
  if (!normalizedAvatarUrl) {
    throw new Error("Profile picture URL is required");
  }

  return {
    content: `New profile picture ✨\n\n${NEW_PROFILE_PICTURE_HASHTAG}`,
    imageUrl: JSON.stringify([normalizedAvatarUrl]),
    topicTag: NEW_PROFILE_PICTURE_TOPIC,
    clientRequestId: String(clientRequestId || "").trim() || null,
    postSourceLabel: String(postSourceLabel || "").trim() || null,
  };
};

export function formatGroupMembersAdded(usernames) {
  const names = [...new Set(usernames)].map((username) => `@${username}`);
  const people = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);
  return `${people} ${names.length === 1 ? "was" : "were"} added`;
}

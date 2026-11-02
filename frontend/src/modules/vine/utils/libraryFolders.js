const MAX_FOLDER_DEPTH = 12;
const MAX_FOLDER_PATH_LENGTH = 500;
const MAX_FOLDER_SEGMENT_LENGTH = 100;

const stripControlCharacters = (value) =>
  Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");

export const normalizeLibraryFolderPath = (value) => {
  const segments = stripControlCharacters(value)
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim().slice(0, MAX_FOLDER_SEGMENT_LENGTH))
    .filter((segment) => segment && segment !== "." && segment !== "..");

  return segments.slice(0, MAX_FOLDER_DEPTH).join("/").slice(0, MAX_FOLDER_PATH_LENGTH);
};

export const joinLibraryFolderPath = (...parts) =>
  normalizeLibraryFolderPath(parts.filter(Boolean).join("/"));

export const getLibraryItemFolderPath = (item) =>
  normalizeLibraryFolderPath(item?.folder_path);

export const getLibraryFolderPaths = (items = []) => {
  const paths = new Set();

  items.forEach((item) => {
    const fullPath = getLibraryItemFolderPath(item);
    const segments = fullPath.split("/").filter(Boolean);
    segments.forEach((_, index) => {
      paths.add(segments.slice(0, index + 1).join("/"));
    });
  });

  return [...paths].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
};

export const getLibraryFolderBreadcrumbs = (folderPath) => {
  const segments = normalizeLibraryFolderPath(folderPath).split("/").filter(Boolean);
  return segments.map((label, index) => ({
    label,
    path: segments.slice(0, index + 1).join("/"),
  }));
};

export const getLibraryFolderView = (items = [], folderPath = "") => {
  const currentPath = normalizeLibraryFolderPath(folderPath);
  const prefix = currentPath ? `${currentPath}/` : "";
  const directFiles = items.filter((item) => getLibraryItemFolderPath(item) === currentPath);
  const childFolders = new Map();

  items.forEach((item) => {
    const itemPath = getLibraryItemFolderPath(item);
    if (!itemPath.startsWith(prefix) || itemPath === currentPath) return;

    const remainder = itemPath.slice(prefix.length);
    const childName = remainder.split("/")[0];
    if (!childName) return;

    const childPath = joinLibraryFolderPath(currentPath, childName);
    const current = childFolders.get(childPath) || {
      name: childName,
      path: childPath,
      documentCount: 0,
    };
    current.documentCount += 1;
    childFolders.set(childPath, current);
  });

  return {
    directFiles,
    childFolders: [...childFolders.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    ),
  };
};

export const buildLibraryFolderUploadEntries = (files = [], destinationPath = "") =>
  Array.from(files).map((file) => {
    const relativePath = String(file?.webkitRelativePath || file?.name || "");
    const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segments.pop() || String(file?.name || "Document");
    const folderPath = joinLibraryFolderPath(destinationPath, ...segments);
    const title = fileName.replace(/\.[^.]+$/, "").trim() || "Document";

    return { file, folderPath, title };
  });

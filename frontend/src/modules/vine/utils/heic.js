let heicConverterPromise = null;

export const isHeicLikeFile = (file) => {
  if (!file) return false;
  return (
    /heic|heif/i.test(String(file.type || "")) ||
    /\.heic$/i.test(String(file.name || "")) ||
    /\.heif$/i.test(String(file.name || ""))
  );
};

const loadHeicConverter = async () => {
  if (!heicConverterPromise) {
    heicConverterPromise = import("heic2any").then((mod) => mod.default || mod);
  }
  return heicConverterPromise;
};

export const convertHeicFileToJpeg = async (file) => {
  const heic2any = await loadHeicConverter();

  try {
    const blob = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });
    const outBlob = Array.isArray(blob) ? blob[0] : blob;
    return new File([outBlob], String(file.name || "upload.heic").replace(/\.(heic|heif)$/i, ".jpg"), {
      type: "image/jpeg",
    });
  } catch (err) {
    console.warn("heic2any conversion failed, trying canvas fallback", err);
  }

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!jpegBlob) return null;
    return new File([jpegBlob], String(file.name || "upload.heic").replace(/\.(heic|heif)$/i, ".jpg"), {
      type: "image/jpeg",
    });
  } catch (err) {
    console.warn("Canvas HEIC conversion fallback failed", err);
    return null;
  }
};

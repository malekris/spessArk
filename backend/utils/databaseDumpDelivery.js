import fs from "fs";

function safeAttachmentFilename(filename) {
  return String(filename || "spess_ark_backup.sql").replace(/["\\\r\n]/g, "_");
}

function clearAttachmentHeaders(res) {
  if (typeof res.removeHeader !== "function") return;
  [
    "Content-Type",
    "Content-Disposition",
    "Content-Length",
    "Cache-Control",
    "X-Content-Type-Options",
  ].forEach((header) => res.removeHeader(header));
}

export async function sendDatabaseDumpFile(res, filePath, filename) {
  const attachmentName = safeAttachmentFilename(filename);

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error("The generated database dump is empty.");
    }

    const dumpStream = fs.createReadStream(filePath);

    await new Promise((resolve, reject) => {
      const handleOpen = () => {
        dumpStream.off("error", handleOpenError);
        resolve();
      };
      const handleOpenError = (err) => {
        dumpStream.off("open", handleOpen);
        reject(err);
      };

      dumpStream.once("open", handleOpen);
      dumpStream.once("error", handleOpenError);
    });

    res.status(200);
    res.setHeader("Content-Type", "application/sql; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachmentName}"`
    );
    res.setHeader("Content-Length", String(stats.size));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    await new Promise((resolve, reject) => {
      let settled = false;

      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };

      dumpStream.once("error", (err) => {
        if (res.headersSent) {
          console.error("database dump stream error:", err);
          res.destroy(err);
          settle(resolve);
          return;
        }
        clearAttachmentHeaders(res);
        settle(reject, err);
      });

      res.once("finish", () => settle(resolve));
      res.once("close", () => {
        if (!res.writableFinished) {
          dumpStream.destroy();
        }
        settle(resolve);
      });

      dumpStream.pipe(res);
    });
  } finally {
    await fs.promises.unlink(filePath).catch(() => {});
  }
}

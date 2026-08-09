import { useEffect, useMemo, useState } from "react";
import { convertHeicFileToJpeg, isHeicLikeFile } from "../utils/heic";
import "./SpessNewsManager.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const MAX_WORDS = 400;

const getKampalaDate = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const toForm = (settings = {}) => ({
  heading: String(settings.spess_news_heading || ""),
  body: String(settings.spess_news_body || ""),
  posted_on: String(settings.spess_news_posted_on || "").slice(0, 10) || getKampalaDate(),
  image_url: String(settings.spess_news_image_url || ""),
  published: Number(settings.spess_news_published) === 1 || settings.spess_news_published === true,
});

const countWords = (value) => String(value || "").trim().split(/\s+/).filter(Boolean).length;

export default function SpessNewsManager({ token, settings, onPublished }) {
  const [form, setForm] = useState(() => toForm(settings));
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [savingMode, setSavingMode] = useState("");
  const [notice, setNotice] = useState(null);
  const wordCount = useMemo(() => countWords(form.body), [form.body]);
  const visibleImage = imagePreview || form.image_url;

  useEffect(() => {
    setForm(toForm(settings));
  }, [settings]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice(null);
  };

  const handleImagePick = async (event) => {
    const picked = event.target.files?.[0] || null;
    event.target.value = "";
    if (!picked) return;

    try {
      const normalized = isHeicLikeFile(picked) ? await convertHeicFileToJpeg(picked) : picked;
      if (!normalized) throw new Error("This image could not be prepared.");
      setImageFile(normalized);
      setNotice(null);
    } catch (err) {
      setNotice({ kind: "error", message: err?.message || "This image could not be prepared." });
    }
  };

  const saveNews = async (shouldPublish) => {
    const heading = form.heading.trim();
    const body = form.body.trim();
    if (wordCount > MAX_WORDS) {
      setNotice({ kind: "error", message: `Shorten the story by ${wordCount - MAX_WORDS} words.` });
      return;
    }
    if (shouldPublish && (!heading || !body)) {
      setNotice({ kind: "error", message: "Add both a heading and story before publishing." });
      return;
    }

    try {
      setSavingMode(shouldPublish ? "publish" : "draft");
      setNotice(null);
      let imageUrl = form.image_url;

      // Upload first, then publish the returned URL with the story in one settings update.
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("image", imageFile);
        const uploadResponse = await fetch(`${API}/api/vine/site-visuals/spess-news-image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: uploadData,
        });
        const uploadBody = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) {
          throw new Error(uploadBody?.message || "Failed to upload the news image.");
        }
        imageUrl = String(uploadBody.url || "").trim();
      }

      const response = await fetch(`${API}/api/vine/site-visuals/spess-news`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          heading,
          body,
          posted_on: form.posted_on,
          image_url: imageUrl,
          published: shouldPublish,
        }),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody?.message || "Failed to save SPESS News.");
      }

      const savedSettings = responseBody.settings || {};
      setForm(toForm(savedSettings));
      setImageFile(null);
      onPublished?.(savedSettings);
      setNotice({
        kind: "success",
        message: shouldPublish
          ? "Story published. It is now live on the school homepage."
          : form.published
            ? "Story unpublished and returned to drafts."
            : "Draft saved. It remains hidden from the homepage.",
      });
    } catch (err) {
      setNotice({ kind: "error", message: err?.message || "Failed to save SPESS News." });
    } finally {
      setSavingMode("");
    }
  };

  return (
    <section className="guardian-spess-news" aria-labelledby="guardian-spess-news-title">
      <header className="guardian-spess-news-head">
        <div>
          <span className="guardian-news-label">Public Website</span>
          <h4 id="guardian-spess-news-title">SPESS News</h4>
          <p>Publish the current school story shown beside Important Dates on the homepage.</p>
        </div>
        <div className={`guardian-spess-news-status ${form.published ? "published" : "draft"}`}>
          <span aria-hidden="true" />
          {form.published ? "Published on homepage" : "Draft not published"}
        </div>
      </header>

      <div className="guardian-spess-news-layout">
        <div className="guardian-spess-news-fields">
          <label>
            <span>News heading</span>
            <input
              type="text"
              maxLength={180}
              value={form.heading}
              placeholder="A clear headline for visitors"
              onChange={(event) => updateField("heading", event.target.value)}
            />
          </label>

          <label>
            <span>Date posted</span>
            <input
              type="date"
              value={form.posted_on}
              onChange={(event) => updateField("posted_on", event.target.value)}
            />
          </label>

          <label className="guardian-spess-news-story">
            <span>Story</span>
            <textarea
              rows={10}
              value={form.body}
              placeholder="Write the school update here..."
              onChange={(event) => updateField("body", event.target.value)}
            />
            <small className={wordCount > MAX_WORDS ? "over" : ""}>
              {wordCount} / {MAX_WORDS} words
            </small>
          </label>
        </div>

        <div className="guardian-spess-news-media">
          <div className={`guardian-spess-news-preview ${visibleImage ? "has-image" : ""}`}>
            {visibleImage ? (
              <img src={visibleImage} alt="SPESS News preview" />
            ) : (
              <div>
                <strong>News image</strong>
                <span>Optional landscape photo</span>
              </div>
            )}
          </div>

          <label className="guardian-spess-news-upload">
            <input type="file" accept="image/*,.heic,.heif" onChange={handleImagePick} />
            <span>{visibleImage ? "Replace picture" : "Choose picture"}</span>
          </label>

          {visibleImage && (
            <button
              type="button"
              className="guardian-spess-news-remove"
              onClick={() => {
                setImageFile(null);
                updateField("image_url", "");
              }}
            >
              Remove picture
            </button>
          )}
        </div>
      </div>

      <footer className="guardian-spess-news-footer">
        <div aria-live="polite">
          {notice && <span className={`guardian-spess-news-notice ${notice.kind}`}>{notice.message}</span>}
        </div>
        <div className="guardian-spess-news-actions">
          <button
            type="button"
            className="guardian-spess-news-draft"
            disabled={Boolean(savingMode) || wordCount > MAX_WORDS}
            onClick={() => saveNews(false)}
          >
            {savingMode === "draft"
              ? "Saving..."
              : form.published
                ? "Unpublish Story"
                : "Save Draft"}
          </button>
          <button
            type="button"
            className="guardian-spess-news-save"
            disabled={Boolean(savingMode) || wordCount > MAX_WORDS}
            onClick={() => saveNews(true)}
          >
            {savingMode === "publish"
              ? "Publishing..."
              : form.published
                ? "Update Published Story"
                : "Publish Story"}
          </button>
        </div>
      </footer>
    </section>
  );
}

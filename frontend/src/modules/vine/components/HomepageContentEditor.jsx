import { normalizeHomepageContent } from "../../../utils/siteVisuals";

const TextField = ({ label, value, onChange, multiline = false, disabled = false, maxLength }) => (
  <label className="guardian-home-field">
    <span>{label}</span>
    {multiline ? (
      <textarea
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : (
      <input
        type="text"
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    )}
  </label>
);

export default function HomepageContentEditor({
  content: rawContent,
  imageFile,
  imagePreviewUrl,
  saving,
  disabled,
  onChange,
  onImagePick,
  onClearImage,
  onRemovePublishedImage,
  onSave,
}) {
  const content = rawContent || normalizeHomepageContent({});
  const updateSection = (section, patch) => onChange({
    ...content,
    [section]: { ...content[section], ...patch },
  });
  const updateSectionItem = (section, index, patch) => {
    const items = content[section].items || content[section].cards || [];
    const nextItems = items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    ));
    const key = content[section].items ? "items" : "cards";
    updateSection(section, { [key]: nextItems });
  };
  const updateFaq = (index, patch) => onChange({
    ...content,
    faqs: content.faqs.map((faq, faqIndex) => (faqIndex === index ? { ...faq, ...patch } : faq)),
  });
  const updateQuickAction = (index, label) => onChange({
    ...content,
    quick_actions: content.quick_actions.map((action, actionIndex) => (
      actionIndex === index ? { ...action, label } : action
    )),
  });

  return (
    <details className="guardian-homepage-editor" open>
      <summary>
        <span>
          <strong>Homepage Content</strong>
          <small>Feature cards, academics, leadership, platforms, FAQs, and mobile actions</small>
        </span>
        <span className="guardian-home-editor-toggle" aria-hidden="true">+</span>
      </summary>

      <div className="guardian-home-editor-body">
        <section className="guardian-home-editor-section">
          <div className="guardian-home-editor-heading">
            <span>01</span>
            <div><strong>Why choose SPESS?</strong><small>Four value cards on the homepage.</small></div>
          </div>
          <div className="guardian-home-editor-grid guardian-home-editor-grid--three">
            <TextField label="Section label" value={content.why_spess.eyebrow} disabled={disabled} maxLength={80} onChange={(value) => updateSection("why_spess", { eyebrow: value })} />
            <TextField label="Section heading" value={content.why_spess.title} disabled={disabled} maxLength={180} onChange={(value) => updateSection("why_spess", { title: value })} />
            <TextField label="Section introduction" value={content.why_spess.intro} disabled={disabled} maxLength={500} onChange={(value) => updateSection("why_spess", { intro: value })} />
          </div>
          <div className="guardian-home-card-editor-grid">
            {content.why_spess.cards.map((card, index) => (
              <div className="guardian-home-mini-card" key={`why-${index}`}>
                <span>Card {index + 1}</span>
                <TextField label="Title" value={card.title} disabled={disabled} maxLength={100} onChange={(value) => updateSectionItem("why_spess", index, { title: value })} />
                <TextField label="Description" value={card.body} disabled={disabled} maxLength={400} multiline onChange={(value) => updateSectionItem("why_spess", index, { body: value })} />
              </div>
            ))}
          </div>
        </section>

        <section className="guardian-home-editor-section">
          <div className="guardian-home-editor-heading">
            <span>02</span>
            <div><strong>Academic pathways</strong><small>O-Level and A-Level pathway content.</small></div>
          </div>
          <div className="guardian-home-editor-grid guardian-home-editor-grid--three">
            <TextField label="Section label" value={content.academic_pathways.eyebrow} disabled={disabled} maxLength={80} onChange={(value) => updateSection("academic_pathways", { eyebrow: value })} />
            <TextField label="Section heading" value={content.academic_pathways.title} disabled={disabled} maxLength={180} onChange={(value) => updateSection("academic_pathways", { title: value })} />
            <TextField label="Section introduction" value={content.academic_pathways.intro} disabled={disabled} maxLength={500} onChange={(value) => updateSection("academic_pathways", { intro: value })} />
          </div>
          <div className="guardian-home-card-editor-grid guardian-home-card-editor-grid--two">
            {content.academic_pathways.items.map((item, index) => (
              <div className="guardian-home-mini-card" key={`pathway-${index}`}>
                <span>Pathway {index + 1}</span>
                <TextField label="Level label" value={item.label} disabled={disabled} maxLength={60} onChange={(value) => updateSectionItem("academic_pathways", index, { label: value })} />
                <TextField label="Title" value={item.title} disabled={disabled} maxLength={140} onChange={(value) => updateSectionItem("academic_pathways", index, { title: value })} />
                <TextField label="Description" value={item.body} disabled={disabled} maxLength={600} multiline onChange={(value) => updateSectionItem("academic_pathways", index, { body: value })} />
                <TextField
                  label="Highlights (one per line)"
                  value={item.highlights.join("\n")}
                  disabled={disabled}
                  multiline
                  onChange={(value) => updateSectionItem("academic_pathways", index, {
                    highlights: value.split("\n").map((entry) => entry.trim()).filter(Boolean).slice(0, 5),
                  })}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="guardian-home-editor-section guardian-home-leadership-editor">
          <div className="guardian-home-editor-heading">
            <span>03</span>
            <div><strong>Headteacher’s welcome</strong><small>Leadership message and optional portrait.</small></div>
          </div>
          <div className="guardian-home-leadership-layout">
            <div className="guardian-home-portrait-editor">
              <div className="guardian-home-portrait-preview">
                {imagePreviewUrl ? <img src={imagePreviewUrl} alt="Headteacher preview" /> : <span>No portrait yet</span>}
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Upload headteacher image</span>
                <input className="guardian-auth-upload-input" type="file" accept="image/*,.heic,.heif" disabled={disabled} onChange={onImagePick} />
                <span className="guardian-auth-upload-cta">Choose portrait</span>
                <span className="guardian-auth-upload-copy">{imageFile ? imageFile.name : "JPG, PNG, WebP, HEIC or HEIF"}</span>
              </label>
              <div className="guardian-home-inline-actions">
                {imageFile && <button type="button" className="guardian-csv-btn guardian-auth-clear" disabled={disabled} onClick={onClearImage}>Clear selection</button>}
                {!imageFile && content.headteacher.image_url && <button type="button" className="guardian-csv-btn guardian-auth-reset" disabled={disabled} onClick={onRemovePublishedImage}>Remove portrait</button>}
              </div>
            </div>
            <div className="guardian-home-editor-grid">
              <TextField label="Section label" value={content.headteacher.eyebrow} disabled={disabled} maxLength={100} onChange={(value) => updateSection("headteacher", { eyebrow: value })} />
              <TextField label="Heading" value={content.headteacher.title} disabled={disabled} maxLength={180} onChange={(value) => updateSection("headteacher", { title: value })} />
              <div className="guardian-home-editor-grid guardian-home-editor-grid--two">
                <TextField label="Headteacher name" value={content.headteacher.name} disabled={disabled} maxLength={120} onChange={(value) => updateSection("headteacher", { name: value })} />
                <TextField label="Role/title" value={content.headteacher.role} disabled={disabled} maxLength={120} onChange={(value) => updateSection("headteacher", { role: value })} />
              </div>
              <TextField label="Welcome message" value={content.headteacher.message} disabled={disabled} maxLength={1500} multiline onChange={(value) => updateSection("headteacher", { message: value })} />
            </div>
          </div>
        </section>

        <section className="guardian-home-editor-section">
          <div className="guardian-home-editor-heading">
            <span>04</span>
            <div><strong>Digital platforms</strong><small>Descriptions and button labels; destinations remain protected.</small></div>
          </div>
          <div className="guardian-home-editor-grid guardian-home-editor-grid--three">
            <TextField label="Section label" value={content.digital_platforms.eyebrow} disabled={disabled} maxLength={80} onChange={(value) => updateSection("digital_platforms", { eyebrow: value })} />
            <TextField label="Section heading" value={content.digital_platforms.title} disabled={disabled} maxLength={180} onChange={(value) => updateSection("digital_platforms", { title: value })} />
            <TextField label="Section introduction" value={content.digital_platforms.intro} disabled={disabled} maxLength={500} onChange={(value) => updateSection("digital_platforms", { intro: value })} />
          </div>
          <div className="guardian-home-card-editor-grid">
            {content.digital_platforms.items.map((item, index) => (
              <div className="guardian-home-mini-card" key={item.key}>
                <span>{item.key}</span>
                <TextField label="Title" value={item.title} disabled={disabled} maxLength={100} onChange={(value) => updateSectionItem("digital_platforms", index, { title: value })} />
                <TextField label="Description" value={item.body} disabled={disabled} maxLength={500} multiline onChange={(value) => updateSectionItem("digital_platforms", index, { body: value })} />
                <TextField label="Button label" value={item.cta} disabled={disabled} maxLength={50} onChange={(value) => updateSectionItem("digital_platforms", index, { cta: value })} />
              </div>
            ))}
          </div>
        </section>

        <section className="guardian-home-editor-section">
          <div className="guardian-home-editor-heading">
            <span>05</span>
            <div><strong>Frequently asked questions</strong><small>Up to eight homepage questions.</small></div>
          </div>
          <div className="guardian-home-faq-editor-list">
            {content.faqs.map((faq, index) => (
              <div className="guardian-home-faq-editor" key={`faq-${index}`}>
                <span>FAQ {index + 1}</span>
                <TextField label="Question" value={faq.question} disabled={disabled} maxLength={180} onChange={(value) => updateFaq(index, { question: value })} />
                <TextField label="Answer" value={faq.answer} disabled={disabled} maxLength={800} multiline onChange={(value) => updateFaq(index, { answer: value })} />
                {content.faqs.length > 1 && (
                  <button type="button" className="guardian-csv-btn guardian-auth-reset" disabled={disabled} onClick={() => onChange({ ...content, faqs: content.faqs.filter((_, faqIndex) => faqIndex !== index) })}>Remove FAQ</button>
                )}
              </div>
            ))}
          </div>
          {content.faqs.length < 8 && (
            <button type="button" className="guardian-csv-btn" disabled={disabled} onClick={() => onChange({ ...content, faqs: [...content.faqs, { question: "New question", answer: "Add the answer here." }] })}>Add FAQ</button>
          )}
        </section>

        <section className="guardian-home-editor-section">
          <div className="guardian-home-editor-heading">
            <span>06</span>
            <div><strong>Mobile quick actions</strong><small>Edit the four labels; destinations remain fixed and safe.</small></div>
          </div>
          <div className="guardian-home-editor-grid guardian-home-editor-grid--four">
            {content.quick_actions.map((action, index) => (
              <TextField key={action.key} label={`${action.key} label`} value={action.label} disabled={disabled} maxLength={30} onChange={(value) => updateQuickAction(index, value)} />
            ))}
          </div>
        </section>

        <div className="guardian-home-editor-publish">
          <p>Publishing updates the public homepage immediately. Empty required text falls back to the current safe default.</p>
          <button type="button" className="guardian-csv-btn guardian-news-save-hot" disabled={disabled} onClick={onSave}>{saving ? "Publishing homepage..." : "Publish homepage content"}</button>
        </div>
      </div>
    </details>
  );
}

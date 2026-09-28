import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./HomepageExperience.css";

const platformTone = (key) => ({ ark: "blue", vine: "green", reports: "gold" }[key] || "blue");

const QuickLink = ({ action, className = "" }) => {
  const content = (
    <>
      <span className={`homepage-quick-mark ${action.key}`} aria-hidden="true">
        {action.key === "contact" ? "✦" : action.label.slice(0, 1)}
      </span>
      <span>{action.label}</span>
    </>
  );

  return action.href.startsWith("#") ? (
    <a className={className} href={action.href}>{content}</a>
  ) : (
    <Link className={className} to={action.href}>{content}</Link>
  );
};

export function HomepageStorySections() {
  const { homepage_content: content, activities_gallery: activityGallery = [] } = useSiteVisuals();
  const [desktopCardsEnabled, setDesktopCardsEnabled] = useState(false);
  const [expandedWhyCard, setExpandedWhyCard] = useState(null);
  const why = content.why_spess;
  const pathways = content.academic_pathways;
  const platforms = content.digital_platforms;
  const headteacher = content.headteacher;
  const galleryPositions = [0.08, 0.37, 0.64, 0.87];
  const whyCardImages = why.cards.map((_, index) => (
    activityGallery[Math.min(
      activityGallery.length - 1,
      Math.floor(activityGallery.length * galleryPositions[index])
    )] || ""
  ));

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 921px) and (hover: hover) and (pointer: fine)");
    const syncDesktopCards = () => {
      setDesktopCardsEnabled(desktopQuery.matches);
      if (!desktopQuery.matches) setExpandedWhyCard(null);
    };
    syncDesktopCards();
    desktopQuery.addEventListener("change", syncDesktopCards);
    return () => desktopQuery.removeEventListener("change", syncDesktopCards);
  }, []);

  useEffect(() => {
    if (expandedWhyCard === null) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setExpandedWhyCard(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expandedWhyCard]);

  const expandWhyCard = (index) => {
    if (!desktopCardsEnabled) return;
    setExpandedWhyCard((current) => (current === index ? null : index));
  };

  const handleWhyCardKeyDown = (event, index) => {
    if (!desktopCardsEnabled || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    setExpandedWhyCard((current) => (current === index ? null : index));
  };

  return (
    <div className="homepage-experience">
      <section className="homepage-why" aria-labelledby="homepage-why-title">
        {desktopCardsEnabled && expandedWhyCard !== null && (
          <button
            type="button"
            className="homepage-why-card-dismiss"
            aria-label="Close expanded feature card"
            onClick={() => setExpandedWhyCard(null)}
          />
        )}
        <div className="homepage-section-inner">
          <header className="homepage-section-heading homepage-section-heading-centered">
            <span>{why.eyebrow}</span>
            <h2 id="homepage-why-title">{why.title}</h2>
            <p>{why.intro}</p>
          </header>
          <div className="homepage-why-grid">
            {why.cards.map((card, index) => (
              <article
                className={`homepage-why-card ${expandedWhyCard === index ? "is-expanded" : ""}`}
                key={`${card.title}-${index}`}
                role={desktopCardsEnabled ? "button" : undefined}
                tabIndex={desktopCardsEnabled ? 0 : undefined}
                aria-expanded={desktopCardsEnabled ? expandedWhyCard === index : undefined}
                onClick={() => expandWhyCard(index)}
                onKeyDown={(event) => handleWhyCardKeyDown(event, index)}
              >
                {whyCardImages[index] && (
                  <div className="homepage-why-card-image" aria-hidden="true">
                    <img src={whyCardImages[index]} alt="" loading="lazy" />
                  </div>
                )}
                <div className="homepage-why-card-copy">
                  <span className="homepage-card-index" aria-hidden="true">0{index + 1}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
                <span className="homepage-why-card-expand-mark" aria-hidden="true">
                  {expandedWhyCard === index ? "×" : "↗"}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="academics" className="homepage-pathways" aria-labelledby="homepage-pathways-title">
        <div className="homepage-section-inner homepage-split-heading">
          <header className="homepage-section-heading">
            <span>{pathways.eyebrow}</span>
            <h2 id="homepage-pathways-title">{pathways.title}</h2>
          </header>
          <p className="homepage-section-intro">{pathways.intro}</p>
        </div>
        <div className="homepage-section-inner homepage-pathway-grid">
          {pathways.items.map((item, index) => (
            <article className={`homepage-pathway-card pathway-${index + 1}`} key={`${item.label}-${index}`}>
              <div className="homepage-pathway-topline">
                <span>{item.label}</span>
                <small>{String(index + 1).padStart(2, "0")}</small>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <ul>
                {item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="homepage-leadership" aria-labelledby="homepage-leadership-title">
        <div className="homepage-section-inner homepage-leadership-card">
          <div className={`homepage-leadership-portrait ${headteacher.image_url ? "has-image" : ""}`}>
            {headteacher.image_url ? (
              <img src={headteacher.image_url} alt={`${headteacher.name}, ${headteacher.role}`} loading="lazy" />
            ) : (
              <div className="homepage-leadership-placeholder" aria-hidden="true">
                <span>SPESS</span>
                <strong>Leadership</strong>
              </div>
            )}
          </div>
          <div className="homepage-leadership-copy">
            <span className="homepage-leadership-eyebrow">{headteacher.eyebrow}</span>
            <span className="homepage-quote-mark" aria-hidden="true">“</span>
            <h2 id="homepage-leadership-title">{headteacher.title}</h2>
            <blockquote>{headteacher.message}</blockquote>
            <div className="homepage-leadership-signature">
              <strong>{headteacher.name}</strong>
              <span>{headteacher.role}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="homepage-platforms" aria-labelledby="homepage-platforms-title">
        <div className="homepage-section-inner">
          <header className="homepage-section-heading homepage-section-heading-centered">
            <span>{platforms.eyebrow}</span>
            <h2 id="homepage-platforms-title">{platforms.title}</h2>
            <p>{platforms.intro}</p>
          </header>
          <div className="homepage-platform-grid">
            {platforms.items.map((platform) => (
              <article className={`homepage-platform-card ${platformTone(platform.key)}`} key={platform.key}>
                <span className="homepage-platform-mark" aria-hidden="true">{platform.title.slice(0, 1)}</span>
                <div>
                  <h3>{platform.title}</h3>
                  <p>{platform.body}</p>
                </div>
                <Link to={platform.href}>{platform.cta}<span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function HomepageFaq() {
  const { homepage_content: content } = useSiteVisuals();

  return (
    <section className="homepage-faq" aria-labelledby="homepage-faq-title">
      <div className="homepage-section-inner homepage-faq-layout">
        <header className="homepage-section-heading">
          <span>Good to know</span>
          <h2 id="homepage-faq-title">Frequently asked questions.</h2>
          <p>Quick answers for learners, families, and visitors.</p>
          <a href="#contact" className="homepage-faq-contact">Still need help? Contact the school →</a>
        </header>
        <div className="homepage-faq-list">
          {content.faqs.map((faq, index) => (
            <details key={`${faq.question}-${index}`}>
              <summary>
                <span>{faq.question}</span>
                <span className="homepage-faq-toggle" aria-hidden="true">+</span>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MobileQuickActions() {
  const { homepage_content: content } = useSiteVisuals();

  return (
    <nav className="homepage-mobile-actions" aria-label="Quick actions">
      {content.quick_actions.map((action) => (
        <QuickLink action={action} className="homepage-mobile-action" key={action.key} />
      ))}
    </nav>
  );
}

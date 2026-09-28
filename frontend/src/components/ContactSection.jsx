import { useState } from "react";
import "./ContactSection.css";
import { useSiteVisuals } from "../utils/siteVisuals";
import VisitorStats from "./VisitorStats";

const SCHOOL_EMAIL = "stphillipsequatorial@gmail.com";

export default function ContactSection() {
  const siteVisuals = useSiteVisuals();
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });
  const contactHeroUrl = siteVisuals?.contact_hero_url || "/celine.jpg";

  const handleSubmit = (e) => {
    e.preventDefault();
    const subject = `Website enquiry from ${formData.name.trim()}`;
    const body = [
      `Name: ${formData.name.trim()}`,
      `Reply-to email: ${formData.email.trim()}`,
      "",
      formData.message.trim(),
    ].join("\n");
    window.location.href = `mailto:${SCHOOL_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <section id="contact" className="contact-section">
      {/* CINEMATIC BANNER */}
      <div
        className="contact-banner"
        style={{ "--contact-hero-image": `url("${contactHeroUrl}")` }}
      >
        <div className="banner-content">
          <h2>Get in <span>Touch</span></h2>
          <p>Official communication channels for St. Phillip’s Equatorial Secondary School.</p>
        </div>
      </div>

      <div className="contact-container">
        <div className="contact-grid">
          
          {/* 1. YouTube Card */}
          <div className="contact-card">
            <div className="card-header">
              <span className="contact-card-index" aria-hidden="true">01</span>
              <h3>Digital Media</h3>
            </div>
            <div className="embed-wrapper">
              <iframe
                src="https://www.youtube.com/embed/iFsTuM36Yds"
                title="SPESS YouTube"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <p className="card-sub">Watch our latest campus highlights and events.</p>
          </div>

          {/* 2. Contact Form Card (NEW) */}
          <div className="contact-card form-card">
            <div className="card-header">
              <span className="contact-card-index" aria-hidden="true">02</span>
              <h3>Send a Message</h3>
            </div>
            <form onSubmit={handleSubmit} className="contact-form">
              <input 
                type="text" 
                placeholder="Your Name" 
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
              <input 
                type="email" 
                placeholder="Your Email" 
                required
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
              <textarea 
                placeholder="How can we help you?" 
                rows="4" 
                required
                value={formData.message}
                onChange={(e) => setFormData({...formData, message: e.target.value})}
              ></textarea>
              <button type="submit" className="submit-btn">Send a Message</button>
              <p className="contact-email-note">
                Opens your email app with the message addressed to{" "}
                <a href={`mailto:${SCHOOL_EMAIL}`}>{SCHOOL_EMAIL}</a>.
              </p>
            </form>
          </div>

          {/* 3. Google Maps Card */}
          <div className="contact-card">
            <div className="card-header">
              <span className="contact-card-index" aria-hidden="true">03</span>
              <h3>Our Location</h3>
            </div>
            <div className="embed-wrapper">
              {/* Note: Standard embed URL structure used here */}
              <iframe
                src="https://www.google.com/maps?q=0.00669%2C32.04758&z=17&output=embed"
                style={{ border: 0 }}
                allowFullScreen=""
                loading="lazy"
                title="School Map"
              />
            </div>
            <p className="card-sub">
              St. Phillip’s Equatorial Secondary School Campus · 0°00&apos;24.1&quot;N, 32°02&apos;51.3&quot;E
            </p>
          </div>

        </div>
      </div>
      <VisitorStats />
    </section>
  );
}

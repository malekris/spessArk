// src/components/ContactSection.jsx
import "./ContactSection.css";

export default function ContactSection() {
  return (
    <section id="contact" className="contact-section">
      <div className="contact-container">
        <h2>Contact Us</h2>
        <p className="contact-intro">
          Connect with St. Phillip’s Equatorial Secondary School through our official channels.
        </p>

        <div className="contact-grid">
          {/* YouTube */}
          <div className="contact-card">
            <h3>📺 Our YouTube Channel</h3>
            <div className="embed-wrapper">
              <iframe
                src="https://www.youtube.com/embed/iFsTuM36Yds?start=222"
                title="SPESS YouTube"
                allowFullScreen
              />
            </div>
          </div>

          {/* Google Maps */}
          <div className="contact-card">
            <h3>📍 Visit Our Campus</h3>
            <div className="embed-wrapper">
            <iframe
               src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3989.818293959792!2d32.046763!3d0.0065891!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x177d61d1b27cb379%3A0xd39a2ac405b94b51!2sSt.%20Philips%20Secondary%20School!5e0!3m2!1sen!2sug!4v1768753063422!5m2!1sen!2sug"
                style={{ border: 0, width: "100%", height: "100%" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="St. Philips Secondary School Map"
                />

            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import React, { useState } from "react";
import "./ContactSection.css";

export default function ContactSection() {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Form Submitted:", formData);
    alert("Message sent to SPESS Registry!");
  };

  return (
    <section id="contact" className="contact-section">
      {/* CINEMATIC BANNER */}
      <div className="contact-banner">
        <div className="banner-content">
          <h1>Get in <span>Touch</span></h1>
          <p>Official communication channels for St. Phillip’s Equatorial Secondary School.</p>
        </div>
      </div>

      <div className="contact-container">
        <div className="contact-grid">
          
          {/* 1. YouTube Card */}
          <div className="contact-card">
            <div className="card-header">
              <span className="icon">📺</span>
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
              <span className="icon">✉️</span>
              <h3>Send a Message</h3>
            </div>
            <form onSubmit={handleSubmit} className="contact-form">
              <input 
                type="text" 
                placeholder="Your Name" 
                required 
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
              <input 
                type="email" 
                placeholder="Your Email" 
                required 
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
              <textarea 
                placeholder="How can we help you?" 
                rows="4" 
                required
                onChange={(e) => setFormData({...formData, message: e.target.value})}
              ></textarea>
              <button type="submit" className="submit-btn">Send to school EMAIL</button>
            </form>
          </div>

          {/* 3. Google Maps Card */}
          <div className="contact-card">
            <div className="card-header">
              <span className="icon">📍</span>
              <h3>Our Location</h3>
            </div>
            <div className="embed-wrapper">
              {/* Note: Standard embed URL structure used here */}
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3989.758814725345!2d32.5825!3d0.3476!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMMKwMjAnNTEuNCJOIDMywrAzNSc1Ny4wIkU!5e0!3m2!1sen!2sug!4v1625000000000!5m2!1sen!2sug"
                style={{ border: 0 }}
                allowFullScreen=""
                loading="lazy"
                title="School Map"
              />
            </div>
            <p className="card-sub">St. Phillip’s Equatorial Secondary School Campus.</p>
          </div>

        </div>
      </div>
    </section>
  );
}
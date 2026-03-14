import React from "react";
import badge from "../assets/badge.png";
import "./Navbar.css";

export default function Navbar() {
  return (
    <nav style={styles.nav}>
      <div style={styles.logoWrap}>
        <img src={badge} alt="St. Phillip’s Equatorial Secondary School badge" style={styles.badge} />
        <div style={styles.logo}>
          <span className="brand-desktop">St. Phillip’s Equatorial SS</span>
        </div>
      </div>

      <div style={styles.links}>
        <a href="#home" style={styles.link}>Home</a>
        <a href="#activities" style={styles.link}>Activities</a>
        <a href="#contact" style={styles.link}>Contact</a>
        <a href="/ark" style={styles.arkBtn}>SPESS ARK</a>
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    position: "fixed",          // 🔥 floats above hero
    top: 0,
    left: 0,
    width: "100%",
    zIndex: 2000,

    background: "rgba(2, 6, 23, 0.6)", // deep navy glass
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",

    padding: "0.75rem 1.4rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  logoWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },

  badge: {
    width: "42px",
    height: "42px",
    objectFit: "contain",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.12)",
    padding: "4px",
    boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
  },

  logo: {
    color: "white",
    fontWeight: 800,
    letterSpacing: "0.2em",
    fontSize: "0.95rem",
  },

  links: {
    display: "flex",
    gap: "1.1rem",
    alignItems: "center",
  },

  link: {
    color: "#e5e7eb",
    textDecoration: "none",
    fontSize: "0.9rem",
    opacity: 0.85,
  },

  arkBtn: {
    padding: "0.45rem 0.9rem",
    background: "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "white",
    borderRadius: "0.7rem",
    textDecoration: "none",
    fontSize: "0.85rem",
    fontWeight: 600,
    boxShadow: "0 8px 20px rgba(37,99,235,0.4)",
  },
};

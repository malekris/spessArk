import { useState } from "react";
import badge from "../assets/badge.png";
import "./Navbar.css";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <a className="site-nav-brand" href="#home" onClick={closeMenu}>
        <img src={badge} alt="" className="site-nav-badge" />
        <span>
          <strong>St. Phillip&apos;s</strong>
          <small>Equatorial Secondary School</small>
        </span>
      </a>

      <button
        type="button"
        className={`site-nav-menu-toggle ${menuOpen ? "open" : ""}`}
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      <div className={`site-nav-links ${menuOpen ? "open" : ""}`}>
        <a href="#home" onClick={closeMenu}>Home</a>
        <a href="#updates" onClick={closeMenu}>Updates</a>
        <a href="#activities" onClick={closeMenu}>Activities</a>
        <a href="#contact" onClick={closeMenu}>Contact</a>
        <a href="/ark" className="site-nav-ark" onClick={closeMenu}>SPESS ARK</a>
      </div>
    </nav>
  );
}

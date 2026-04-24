import { Link } from "react-router-dom";
import "./HomeSection.css";
import useScrollReveal from "../hooks/useScrollReveal";
import { useSiteVisuals } from "../utils/siteVisuals";

export default function HomeSection() {
  useScrollReveal();
  const siteVisuals = useSiteVisuals();
  const heroImage = siteVisuals.home_hero_url || "/newhome.jpg";

  return (
    <section id="home" className="home-section">
      {/* HERO SECTION */}
      <div className="hero">
        <div className="hero-media" aria-hidden="true">
          <img
            src={heroImage}
            alt=""
            className="hero-backdrop-image"
          />
          <div className="hero-backdrop-tint" />
        </div>

        <img
          src={heroImage}
          alt="Students of St. Phillip’s Equatorial Secondary School"
          className="hero-main-image"
          loading="eager"
        />

        <div className="hero-overlay" />

        <div className="hero-content">
          <h1>St. Phillip’s <span>Equatorial SS</span></h1>
          <p className="hero-motto">
            Our motto <span>&ldquo;Work and Live by Faith&rdquo;</span>
          </p>
          <div className="hero-divider" />
        </div>
      </div>

      {/* INSTITUTIONAL PROFILE & WELCOME */}
      <div className="welcome-container">
        <div className="home-content reveal">
          {/* Label Header */}
          <div className="profile-label">
            <span className="dot"></span>
            WHO WE ARE
          </div>
          
          <h2 className="welcome-title">Welcome to St. Phillip’s</h2>

          <div className="profile-body">
            <p className="lead-text">
              St. Phillip’s Equatorial Secondary School was founded in 1994 and stands as a
              proud centre of learning in the Central Buganda Diocese under the Church of
              Uganda foundation.
            </p>

            <div className="profile-details">
              <p>
                The school serves a diverse population of learners from all walks of life,
                creating a welcoming community where discipline, faith, and academic growth
                go hand in hand.
              </p>
              <p>
                We offer both O-Level and A-Level education, and as a government USE school,
                we remain committed to making quality education accessible while preparing
                learners for higher studies, service, and responsible citizenship.
              </p>
            </div>
          </div>
        </div>
        <div className="vine-entry">
        <p className="vine-subtext">
            Find out what’s happening around St. Phillip’s
        </p>

          <Link to="/vine/enter" className="vine-btn-landing">
             🌱 Enter Vine
            </Link>
</div>

      </div>
    </section>
  );
}

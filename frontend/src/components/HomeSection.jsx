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
      <div className="hero">
        <img
          src={heroImage}
          alt="Students of St. Phillip's Equatorial Secondary School"
          className="hero-main-image"
          loading="eager"
        />
        <div className="hero-image-shade" aria-hidden="true" />

        <div className="hero-content">
          <span className="hero-eyebrow">Faith. Learning. Service.</span>
          <h1>St. Phillip&apos;s Equatorial Secondary School</h1>
          <p className="hero-intro">
            Building disciplined, confident learners in a community where academic growth and faith move together.
          </p>
          <p className="hero-motto">
            <span>Our motto</span>
            <strong>Work and Live by Faith</strong>
          </p>

          <div className="hero-actions" aria-label="School platforms">
            <Link to="/ark" className="hero-action hero-action-ark">Open SPESS ARK</Link>
            <Link to="/vine/enter" className="hero-action hero-action-vine">Enter SPESS Vine</Link>
          </div>
        </div>
      </div>

      <div className="welcome-container reveal">
        <header className="welcome-heading">
          <span>Who we are</span>
          <h2>A school community shaped by purpose.</h2>
        </header>

        <div className="welcome-profile">
          <p className="welcome-lead">
            Founded in 1994, St. Phillip&apos;s Equatorial Secondary School is a proud centre of learning in the Central Buganda Diocese under the Church of Uganda foundation.
          </p>
          <p>
            We serve learners from all walks of life through O-Level and A-Level education. As a government USE school, we remain committed to accessible, quality education that prepares young people for higher studies, service, and responsible citizenship.
          </p>
        </div>

        <dl className="school-facts" aria-label="School profile">
          <div>
            <dt>Established</dt>
            <dd>1994</dd>
          </div>
          <div>
            <dt>Learning pathway</dt>
            <dd>O-Level &amp; A-Level</dd>
          </div>
          <div>
            <dt>Foundation</dt>
            <dd>Church of Uganda</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./VineLegalPage.css";

const LEGAL_CONTENT = {
  terms: {
    title: "Terms of Service",
    sections: [
      {
        heading: "Using Vine",
        body: "By using Vine, you agree not to post illegal content, abuse other users, or attempt to disrupt the platform. You are responsible for activity on your account.",
      },
      {
        heading: "Account and Content",
        body: "You keep ownership of your content, but you grant Vine permission to host, display, and distribute it within the service. Repeated policy violations can lead to restrictions or suspension.",
      },
      {
        heading: "Safety and Enforcement",
        body: "Vine may remove content, issue warnings, limit account actions, or suspend accounts to protect user safety and platform integrity.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "Data We Collect",
        body: "Vine stores account details (username, email, profile data), activity data (posts, likes, follows, messages), and security logs needed to run and secure the platform.",
      },
      {
        heading: "How Data Is Used",
        body: "Data is used to provide features, moderate abuse, improve reliability, and send essential account communications such as verification and security emails.",
      },
      {
        heading: "Your Controls",
        body: "You can manage privacy options in settings, including private profile, message preferences, and visibility options for profile information.",
      },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    sections: [
      {
        heading: "Why Cookies Are Used",
        body: "Cookies and local storage are used for authentication sessions, remembering preferences, and improving app performance.",
      },
      {
        heading: "Types",
        body: "Essential cookies are required for login and security. Functional storage keeps UI preferences such as theme and read state indicators.",
      },
      {
        heading: "Managing Cookies",
        body: "You can control cookie behavior in your browser settings, but disabling essential cookies may prevent some Vine features from working correctly.",
      },
    ],
  },
  accessibility: {
    title: "Accessibility",
    sections: [
      {
        heading: "Commitment",
        body: "Vine aims to support keyboard navigation, readable contrast, clear structure, and compatibility with assistive technologies.",
      },
      {
        heading: "Current Support",
        body: "Core flows are built to work across desktop and mobile layouts, with responsive components and visible interactive controls.",
      },
      {
        heading: "Report Issues",
        body: "If you find an accessibility issue, report it through the Help Center so it can be prioritized and fixed.",
      },
    ],
  },
};

export default function VineLegalPage() {
  const navigate = useNavigate();
  const { page } = useParams();
  const key = String(page || "").toLowerCase();

  const data = useMemo(() => LEGAL_CONTENT[key] || LEGAL_CONTENT.terms, [key]);

  return (
    <div className="vine-legal-page">
      <div className="vine-legal-card">
        <button className="vine-legal-back" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1>{data.title}</h1>
        {data.sections.map((section) => (
          <section key={section.heading} className="vine-legal-section">
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

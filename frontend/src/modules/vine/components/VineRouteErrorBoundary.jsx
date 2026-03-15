import React from "react";
import { useLocation } from "react-router-dom";
import "./VineRouteErrorBoundary.css";

class VineRouteErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Vine route crashed:", error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const hasVineSession = Boolean(localStorage.getItem("vine_token"));

    return (
      <div className="vine-route-error-shell">
        <div className="vine-route-error-card">
          <div className="vine-route-error-kicker">SPESS Vine</div>
          <h1>Something went wrong</h1>
          <p>
            We hit a page error, but Vine is still okay. You can reload this screen or jump
            back into a safe page.
          </p>
          {this.state.error?.message ? (
            <div className="vine-route-error-message">{this.state.error.message}</div>
          ) : null}
          <div className="vine-route-error-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                window.location.href = hasVineSession ? "/vine/feed" : "/vine/login";
              }}
            >
              {hasVineSession ? "Go to feed" : "Go to login"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default function VineRouteErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <VineRouteErrorBoundaryInner resetKey={location.pathname}>
      {children}
    </VineRouteErrorBoundaryInner>
  );
}

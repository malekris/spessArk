import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSearch.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  useEffect(() => {
    document.title = "Vine — Search";
  }, []);

  useEffect(() => {
    fetch(`${API}/api/vine/users/new`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setSuggestions(Array.isArray(data) ? data : []))
      .catch(() => setSuggestions([]));
  }, [token]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      fetch(`${API}/api/vine/users/search?q=${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => setResults(Array.isArray(data) ? data : []))
        .catch(() => setResults([]));
    }, 300); // debounce

    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="search-page">
      <div className="search-header">
        <button onClick={() => navigate("/vine/feed")}>← Back</button>
        <input
          autoFocus
          placeholder="Search by username..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="search-results">
        {!query.trim() && suggestions.length > 0 && (
          <>
            <div className="search-section-title">Viners you may want to follow</div>
            {suggestions.map(user => {
              const avatarSrc = user.avatar_url
                ? (user.avatar_url.startsWith("http") ? user.avatar_url : `${API}${user.avatar_url}`)
                : DEFAULT_AVATAR;
              return (
                <div
                  key={`suggest-${user.id}`}
                  className="search-user"
                  onClick={() => navigate(`/vine/profile/${user.username}`)}
                >
                  <img
                    src={avatarSrc}
                    alt={`${user.username} avatar`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/vine/profile/${user.username}`);
                    }}
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                  <div className="search-user-info">
                    <strong className="search-user-name">
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/vine/profile/${user.username}`);
                        }}
                      >
                        {user.display_name || user.username}
                      </span>
                      {(Number(user.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(user.username || "").toLowerCase())) && (
                        <span className={`verified ${["vine guardian","vine_guardian"].includes(String(user.username || "").toLowerCase()) ? "guardian" : ""}`}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
                            <path
                              d="M20 6L9 17l-5-5"
                              stroke="white"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      )}
                    </strong>
                    <span>@{user.username}</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {results.map(user => {
          const avatarSrc = user.avatar_url
            ? (user.avatar_url.startsWith("http") ? user.avatar_url : `${API}${user.avatar_url}`)
            : DEFAULT_AVATAR;
          return (
          <div
            key={user.id}
            className="search-user"
            onClick={() => navigate(`/vine/profile/${user.username}`)}
          >
            <img
              src={avatarSrc}
              alt={`${user.username} avatar`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/vine/profile/${user.username}`);
              }}
              onError={(e) => {
                e.currentTarget.src = DEFAULT_AVATAR;
              }}
            />

            <div className="search-user-info">
              <strong className="search-user-name">
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/vine/profile/${user.username}`);
                  }}
                >
                  {user.display_name || user.username}
                </span>
                {(Number(user.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(user.username || "").toLowerCase())) && (
                  <span className={`verified ${["vine guardian","vine_guardian"].includes(String(user.username || "").toLowerCase()) ? "guardian" : ""}`}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </strong>
              <span>@{user.username}</span>
            </div>
          </div>
        );
        })}

        {query && results.length === 0 && (
          <p className="empty">No users found</p>
        )}
      </div>
    </div>
  );
}

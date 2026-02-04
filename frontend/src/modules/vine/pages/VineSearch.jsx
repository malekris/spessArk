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
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                  <div>
                    <strong>{user.display_name || user.username}</strong>
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
              onError={(e) => {
                e.currentTarget.src = DEFAULT_AVATAR;
              }}
            />

            <div>
              <strong>{user.display_name || user.username}</strong>
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

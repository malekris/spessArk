import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSearch.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

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
        {results.map(user => (
          <div
            key={user.id}
            className="search-user"
            onClick={() => navigate(`/vine/profile/${user.username}`)}
          >
            {user.avatar_url ? (
              <img src={`${API}${user.avatar_url}`} />
            ) : (
              <div className="avatar-fallback">
                {user.username[0].toUpperCase()}
              </div>
            )}

            <div>
              <strong>{user.display_name || user.username}</strong>
              <span>@{user.username}</span>
            </div>
          </div>
        ))}

        {query && results.length === 0 && (
          <p className="empty">No users found</p>
        )}
      </div>
    </div>
  );
}

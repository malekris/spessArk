import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSearch.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineSearch() {
  const [query, setQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [postResults, setPostResults] = useState([]);
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
      setUserResults([]);
      setPostResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      fetch(`${API}/api/vine/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          setUserResults(Array.isArray(data?.users) ? data.users : []);
          setPostResults(Array.isArray(data?.posts) ? data.posts : []);
        })
        .catch(() => {
          setUserResults([]);
          setPostResults([]);
        });
    }, 300); // debounce

    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="search-page">
      <div className="search-header">
        <button onClick={() => navigate("/vine/feed")}>← Back</button>
        <input
          autoFocus
          placeholder="Search users or posts..."
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

        {query.trim() && userResults.length > 0 && (
          <div className="search-section-title">Users</div>
        )}
        {userResults.map(user => {
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

        {query.trim() && postResults.length > 0 && (
          <div className="search-section-title">Posts</div>
        )}
        {postResults.map((post) => {
          const avatarSrc = post.avatar_url
            ? (post.avatar_url.startsWith("http") ? post.avatar_url : `${API}${post.avatar_url}`)
            : DEFAULT_AVATAR;
          const snippet = (post.content || "").trim();
          return (
            <div
              key={`post-${post.id}`}
              className="search-post"
              onClick={() => navigate(`/vine/feed?post=${post.id}`)}
            >
              <img
                src={avatarSrc}
                alt={`${post.username} avatar`}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/vine/profile/${post.username}`);
                }}
                onError={(e) => {
                  e.currentTarget.src = DEFAULT_AVATAR;
                }}
              />
              <div className="search-post-info">
                <div className="search-user-name">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/vine/profile/${post.username}`);
                    }}
                  >
                    {post.display_name || post.username}
                  </span>
                  {(Number(post.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(post.username || "").toLowerCase())) && (
                    <span className={`verified ${["vine guardian","vine_guardian"].includes(String(post.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
                  <span className="search-post-meta">
                    · {new Date(post.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="search-post-content">
                  {snippet || (post.image_url ? "Photo/video post" : "Post")}
                </div>
                <div className="search-post-stats">
                  ❤️ {post.likes || 0} · 💬 {post.comments || 0} · 🔁 {post.revines || 0}
                </div>
              </div>
            </div>
          );
        })}

        {query && userResults.length === 0 && postResults.length === 0 && (
          <p className="empty">No users or posts found</p>
        )}
      </div>
    </div>
  );
}

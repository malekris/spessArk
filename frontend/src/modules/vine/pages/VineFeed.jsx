import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import "./VineFeed.css"; // The new scoped CSS
import VineSuggestions from "./VineSugguestions";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineFeed() {
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState("");
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  let myUsername = "";
  try {
    const storedUser = JSON.parse(localStorage.getItem("vine_user"));
    myUsername = storedUser?.username || "";
  } catch (e) {
    console.error("User parse error", e);
  }
  


  const loadFeed = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts`);
      const data = await res.json();
      setPosts(data);
    } catch (err) { console.error("Load error"); }
  };

  useEffect(() => { loadFeed(); }, []);

  const submitPost = async () => {
    if (!content.trim()) return;
    try {
      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      const newPost = await res.json();
      setPosts((prev) => [newPost, ...prev]);
      setContent("");
    } catch (err) { console.error("Post error"); }
  };

  return (
    <div className="vine-feed-container">
      <nav className="vine-nav-top">
        <h2 onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>🌱 Vine</h2>
        <div className="nav-right">
  {myUsername && (
    <button
      className="nav-btn profile-btn"
      onClick={() => navigate(`/vine/profile/${myUsername}`)}
    >
      Profile
    </button>
  )}

  <button
    className="nav-btn logout-btn"
    onClick={() => {
      localStorage.removeItem("vine_token");
      navigate("/vine/login");
    }}
  >
    Logout
  </button>
</div>

      </nav>

      <div className="vine-content-wrapper">
        <div className="vine-create-box">
          <textarea
            placeholder="What's happening?" 
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="create-footer">
            <button className="post-submit-btn" onClick={submitPost}>Post</button>
          </div>
        </div>

        <div className="vine-posts-list">
          {posts.map((post) => (
            <VinePostCard 
              key={post.id} 
              post={post} 
              onDeletePost={(id) => setPosts(p => p.filter(x => x.id !== id))} 
            />
          ))}
          {posts.length === 0 && <p className="no-posts-hint">No posts yet 🌱</p>}
        </div>
      </div>
      <div className="vine-right-sidebar">
    <VineSuggestions />
  </div>
    </div>
  );
}
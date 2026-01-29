import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import "./VineFeed.css"; // The new scoped CSS
import VineSuggestions from "./VineSuggestions";
import { socket } from "../../../socket";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineFeed() {
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState("");
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const [unread, setUnread] = useState(0);
  const [handledDeepLink, setHandledDeepLink] = useState(false);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  
  let myUsername = "";
  try {
    const storedUser = JSON.parse(localStorage.getItem("vine_user"));
    myUsername = storedUser?.username || "";
  } catch (e) {
    console.error("User parse error", e);
  }
 
  useEffect(() => {
    if (handledDeepLink) return;
  
    const params = new URLSearchParams(window.location.search);
    const postId = params.get("post");
    const commentId = params.get("comment");
  
    if (!postId) return;
  
    let attempts = 0;
  
    const interval = setInterval(() => {
      const postEl = document.querySelector(`#post-${postId}`);
      if (!postEl) {
        attempts++;
        if (attempts > 10) clearInterval(interval);
        return;
      }
  
      // Open comments
      const openBtn = postEl.querySelector(".action-btn:nth-child(2)");
      openBtn?.click();
  
      if (commentId) {
        setTimeout(() => {
          const commentEl = document.querySelector(`#comment-${commentId}`);
          if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            commentEl.classList.add("highlight-comment");
            setTimeout(() => commentEl.classList.remove("highlight-comment"), 2000);
          }
        }, 400);
      }
  
      setHandledDeepLink(true); // 🔒 CRITICAL: prevents future runs
      clearInterval(interval);
    }, 300);
  
    return () => clearInterval(interval);
  }, [posts, handledDeepLink]);
  
   const loadFeed = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts`);
      const data = await res.json();
      setPosts(data);
    } catch (err) { console.error("Load error"); }
  };
  useEffect(() => {
    loadFeed(); // initial load
  
    const interval = setInterval(() => {
      loadFeed();
    }, 5000); // every 5 seconds
  
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!token) return;
  
    const fetchUnread = async () => {
      try {
        const res = await fetch(`${API}/api/dms/unread-total`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        setUnreadDMs(data.total || 0);
      } catch {}
    };
  
    fetchUnread();
  
    // Real-time update when message arrives
    const handler = () => fetchUnread();
    socket.on("dm_received", handler);
    socket.on("messages_seen", handler);
  
    return () => {
      socket.off("dm_received", handler);
      socket.off("messages_seen", handler);
    };
  }, [token]);
  
  const getGreeting = () => {
    const hour = new Date().getHours();
  
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };
  const submitPost = async () => {
    if (!content.trim() && images.length === 0) return;
  
    try {
      const formData = new FormData();
  
      if (content.trim()) {
        formData.append("content", content);
      }
  
      images.forEach((img) => {
        formData.append("images", img);
      });
  
      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
  
      const newPost = await res.json();
      setPosts((prev) => [newPost, ...prev]);
      setContent("");
      setImages([]);
      setPreviews([]);
    } catch (err) {
      console.error("Post error", err);
    }
  };
  
  
  useEffect(() => {
    if (!token) return;
  
    const user = JSON.parse(localStorage.getItem("vine_user"));
    if (!user?.id) return;
  
    socket.connect();
    socket.emit("register", user.id);
  
    return () => {
      socket.disconnect();
    };
  }, [token]);
// notifications
useEffect(() => {
  if (!token) return;

  const fetchUnreadNotifications = async () => {
    try {
      const res = await fetch(`${API}/api/vine/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setUnread(data.count || 0);
    } catch (err) {
      console.error("Failed to fetch unread notifications");
    }
  };

  // initial load
  fetchUnreadNotifications();

  // 👇 MATCH backend emit
  socket.on("notification", fetchUnreadNotifications);

  return () => {
    socket.off("notification", fetchUnreadNotifications);
  };
}, [token]);


  return (
    <div className="vine-feed-container">
      <nav className="vine-nav-top">
        <h2 onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>🌱 Vine</h2>
        <div
  className="notif-bell"
  onClick={() => navigate("/vine/notifications")}
>
  🔔
  {unread > 0 && <span className="notif-badge">{unread}</span>}
</div>
 
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
      <div className="vine-dm-bar">
  {/* 🔍 Search */}
  <input
    className="vine-search"
    placeholder="Search users..."
    onFocus={() => navigate("/vine/search")}
    readOnly
  />

  {/* 👥 Discover */}
  <button
    className="discover-btn"
    onClick={() => navigate("/vine/suggestions")}
  >
    👥 Discover
  </button>

  {/* 💬 Messages */}
  <button
    className="messages-btn"
    onClick={() => navigate("/vine/dms")}
    style={{ position: "relative" }}
  >
    💬 DM
    {unreadDMs > 0 && (
      <span className="dm-unread-badge">{unreadDMs}</span>
    )}
  </button>
 

      </div>

      <div className="vine-create-box">
           <textarea
                 placeholder="What's happening?"
                value={content}
                maxLength={2000}
                onChange={(e) => setContent(e.target.value)}
                   />

               <div className="create-footer">
              <div className="greeting">
           {getGreeting()}, <span className="name">{myUsername}</span>
           </div>

           <div className="right-actions">
          <span className="char-count">{content.length}/300</span>
          <label className="image-picker">
  📷 Add photos
  <input
    type="file"
    accept="image/*"
    multiple
    hidden
    onChange={(e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      setImages(files);
      setPreviews(files.map(f => URL.createObjectURL(f)));
    }}
  />
</label>
        
{previews.length > 0 && (
  <div className="preview-strip">
    {previews.map((src, i) => (
      <div key={i} className="preview-tile">
        <img src={src} alt="" />
        <button
          className="remove-preview"
          onClick={() => {
            setImages(images.filter((_, idx) => idx !== i));
            setPreviews(previews.filter((_, idx) => idx !== i));
          }}
        >
          ×
        </button>
      </div>
    ))}
  </div>
)}


            <button className="post-submit-btn" onClick={submitPost}>
               Post
              </button>
          
            </div>
              </div>
             </div>


        <div className="vine-posts-list">
          {posts.map((post) => (
            <VinePostCard key={post.feed_id} post={post} />    
          ))}
          {posts.length === 0 && <p className="no-posts-hint">No posts yet 🌱</p>}
        </div>
      </div>
      <div className="vine-right-sidebar">

  </div>
    </div>
  );
}

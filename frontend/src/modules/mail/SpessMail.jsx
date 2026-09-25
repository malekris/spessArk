import { useEffect, useMemo, useState } from "react";
import badge from "../../assets/badge.png";
import { mailApi } from "./mailApi";
import "./SpessMail.css";

const previewMessages = [
  {
    id: "welcome",
    sender: "SPESS Mail",
    email: "welcome@stphillipsequatorial.com",
    initials: "SM",
    subject: "Your new school mailbox is ready",
    snippet: "Welcome to a calmer, safer way to communicate across the SPESS community.",
    time: "9:42 AM",
    unread: true,
    starred: true,
    label: "School",
    tone: "green",
    body: [
      "Hello Lincoln,",
      "Welcome to SPESS Mail — your official St. Phillip’s Equatorial Secondary School email space.",
      "Use this mailbox for academic communication, school notices and collaborating with your teachers. Keep your password private and report suspicious messages to the ICT office.",
      "Work and live by faith.",
    ],
  },
  {
    id: "timetable",
    sender: "Academic Office",
    email: "academics@stphillipsequatorial.com",
    initials: "AO",
    subject: "Updated study timetable · Term III",
    snippet: "The revised evening preparation timetable takes effect from Monday.",
    time: "8:15 AM",
    unread: true,
    starred: false,
    label: "Academic",
    tone: "gold",
    body: [
      "Dear learner,",
      "The revised Term III evening preparation timetable takes effect on Monday. Please review the changes with your class teacher and arrive at every session on time.",
      "A printable copy will be shared through SPESS ARK.",
    ],
  },
  {
    id: "library",
    sender: "School Library",
    email: "library@stphillipsequatorial.com",
    initials: "SL",
    subject: "Your reserved book is available",
    snippet: "Things Fall Apart is ready for collection at the library desk.",
    time: "Yesterday",
    unread: false,
    starred: false,
    label: "Library",
    tone: "blue",
    body: [
      "Hello,",
      "The book you reserved is now ready for collection. Please bring your learner card to the library desk before Friday afternoon.",
      "Happy reading!",
    ],
  },
  {
    id: "vine",
    sender: "SPESS VINE",
    email: "vine@stphillipsequatorial.com",
    initials: "SV",
    subject: "Your weekly community rewind",
    snippet: "Catch up on the best conversations, clubs and classroom moments from this week.",
    time: "Sep 23",
    unread: false,
    starred: true,
    label: "Community",
    tone: "purple",
    body: [
      "Your week on SPESS VINE was full of good things.",
      "Science Club welcomed twelve new members, the Senior Five debate drew a lively crowd, and three new class resources were added to the community library.",
      "Open VINE to see the full rewind.",
    ],
  },
  {
    id: "sports",
    sender: "Games & Sports",
    email: "sports@stphillipsequatorial.com",
    initials: "GS",
    subject: "Friday house matches",
    snippet: "Team lists and reporting times for this Friday’s inter-house matches.",
    time: "Sep 22",
    unread: false,
    starred: false,
    label: "Activities",
    tone: "orange",
    body: [
      "Good afternoon,",
      "Team lists for Friday’s inter-house football and netball fixtures are now on the games noticeboard. Players should report at the lower field by 3:30 PM.",
    ],
  },
];

const folders = [
  ["Inbox", "inbox", "2", 2],
  ["Starred", "star", "", null],
  ["Sent", "sent", "5", null],
  ["Drafts", "draft", "6", 1],
  ["Archive", "archive", "20", null],
  ["Spam", "alert", "4", null],
  ["Trash", "trash", "3", null],
];

const avatarTones = ["green", "gold", "blue", "purple", "orange"];

function displayInitials(value) {
  const words = String(value || "SPESS Mail").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "SM";
}

function messageTone(value) {
  const hash = [...String(value || "")].reduce((total, character) => total + character.charCodeAt(0), 0);
  return avatarTones[hash % avatarTones.length];
}

function formatMailTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function normalizeLiveMessage(message, details = false) {
  const sender = message?.from?.name || message?.from?.address || "Unknown sender";
  return {
    ...message,
    sender,
    email: message?.from?.address || "",
    initials: displayInitials(sender),
    time: formatMailTime(message?.date),
    tone: messageTone(sender),
    label: "Mail",
    body: details
      ? String(message?.body || message?.snippet || "").split(/\n{2,}/).filter(Boolean)
      : [],
  };
}

function Icon({ name, size = 20, strokeWidth = 1.8 }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    compose: <><path d="M13.5 5.5 18.5 10.5M5 19l3.8-.8L19 7a1.8 1.8 0 0 0-2.5-2.5L5.8 15.2 5 19Z" /></>,
    inbox: <><path d="M4 5h16v14H4z" /><path d="m4 13 4-4 4 4 4-4 4 4" /></>,
    star: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></>,
    sent: <><path d="m21 3-8.3 18-2.1-7.6L3 10.7 21 3Z" /><path d="m10.6 13.4 4.8-4.8" /></>,
    draft: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 13h8M8 17h6" /></>,
    archive: <><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" /></>,
    alert: <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8.2A7 7 0 0 1 18.6 7M17.9 15.8A7 7 0 0 1 5.4 17" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    back: <><path d="m15 18-6-6 6-6" /></>,
    reply: <><path d="m9 7-5 5 5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
    forward: <><path d="m15 7 5 5-5 5" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></>,
  };

  return (
    <svg aria-hidden="true" className="mail-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.more}
    </svg>
  );
}

function EntryScreen({ onPreview, onLogin, activationAvailable }) {
  const [entryMode, setEntryMode] = useState("signin");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitForm = async (event) => {
    event.preventDefault();
    setNotice("");
    if (entryMode === "activate") {
      setNotice(activationAvailable
        ? "Learner verification is being prepared for the school register."
        : "Learner activation is waiting for the limited Carbonio provisioning account.");
      return;
    }
    setSubmitting(true);
    try {
      await onLogin({ email, password });
    } catch (error) {
      setNotice(error?.message || "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mail-entry">
      <div className="mail-entry-glow mail-entry-glow-one" />
      <div className="mail-entry-glow mail-entry-glow-two" />
      <section className="mail-entry-story">
        <a className="mail-entry-school" href="/">
          <img src={badge} alt="St. Phillip’s Equatorial Secondary School badge" />
          <span><strong>SPESS</strong><small>Work and live by faith</small></span>
        </a>
        <div className="mail-entry-copy">
          <span className="mail-entry-kicker">A school inbox of our own</span>
          <h1>Every important message, <em>in one calm place.</em></h1>
          <p>SPESS Mail brings learners, teachers and school offices together through safe, official email on our own domain.</p>
          <div className="mail-entry-points">
            <span><Icon name="shield" /> Verified school accounts</span>
            <span><Icon name="lock" /> Private by design</span>
          </div>
        </div>
        <p className="mail-entry-foot">St. Phillip’s Equatorial Secondary School · Nabusanke</p>
      </section>

      <section className="mail-entry-panel" aria-label="SPESS Mail access">
        <div className="mail-entry-card">
          <div className="mail-entry-mobile-brand">
            <img src={badge} alt="" /><span>SPESS <strong>MAIL</strong></span>
          </div>
          <span className="mail-card-eyebrow">Welcome to</span>
          <h2>SPESS <strong>MAIL</strong></h2>
          <p className="mail-card-intro">Official email for our school community.</p>

          <div className="mail-entry-tabs" role="tablist" aria-label="Choose access type">
            <button type="button" role="tab" aria-selected={entryMode === "signin"} className={entryMode === "signin" ? "active" : ""} onClick={() => { setEntryMode("signin"); setNotice(""); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={entryMode === "activate"} className={entryMode === "activate" ? "active" : ""} onClick={() => { setEntryMode("activate"); setNotice(""); }}>Activate account</button>
          </div>

          <form className="mail-entry-form" onSubmit={submitForm}>
            {entryMode === "signin" ? (
              <>
                <label>School email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@stphillipsequatorial.com" autoComplete="username" required /></label>
                <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /></label>
                <div className="mail-form-options"><span>Your session stays private on this device.</span><button type="button">Forgot password?</button></div>
                <button className="mail-primary-button" type="submit" disabled={submitting}>{submitting ? "Opening mailbox…" : "Open my mailbox"} {!submitting && <Icon name="chevron" size={18} />}</button>
              </>
            ) : (
              <>
                <label>Admission number<input type="text" placeholder="e.g. SPESS/2026/0142" autoComplete="off" /></label>
                <label>School activation code<input type="text" placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" /></label>
                <button className="mail-primary-button" type="submit">Verify learner record <Icon name="chevron" size={18} /></button>
                <p className="mail-activation-note"><Icon name="shield" size={17} /> Only active learners in the school register can activate an account.</p>
              </>
            )}
          </form>

          {notice && <div className="mail-entry-notice" role="status">{notice}</div>}

          <button className="mail-preview-button" type="button" onClick={onPreview}>Preview the SPESS Mail interface</button>
          <p className="mail-card-help">Need help? Visit the ICT office.</p>
        </div>
      </section>
    </main>
  );
}

function Avatar({ initials, tone = "green", small = false }) {
  return <span className={`mail-avatar ${tone} ${small ? "small" : ""}`}>{initials}</span>;
}

function ComposeWindow({ onClose, onSend, preview = false, replyTo = null }) {
  const [sentNotice, setSentNotice] = useState("");
  const [to, setTo] = useState(replyTo?.email || "");
  const [subject, setSubject] = useState(replyTo ? `Re: ${String(replyTo.subject || "").replace(/^Re:\s*/i, "")}` : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (preview) {
      setSentNotice("Preview only — sign in with a school mailbox to send this message.");
      return;
    }
    setSending(true);
    setSentNotice("");
    try {
      await onSend({
        to,
        subject,
        body,
        originalId: replyTo?.id || "",
        replyType: replyTo ? "r" : "",
      });
      onClose();
    } catch (error) {
      setSentNotice(error?.message || "The message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mail-compose" aria-label="New message">
      <header><strong>New message</strong><button type="button" onClick={onClose} aria-label="Close compose"><Icon name="close" /></button></header>
      <form onSubmit={handleSubmit}>
        <label><span>To</span><input type="text" aria-label="Recipient" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <input className="mail-compose-subject" placeholder="Subject" aria-label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        <textarea aria-label="Message" placeholder="Write your message…" value={body} onChange={(event) => setBody(event.target.value)} required />
        {sentNotice && <p className="mail-compose-notice" role="status">{sentNotice}</p>}
        <footer><button className="mail-send-button" type="submit" disabled={sending}>{sending ? "Sending…" : "Send"} {!sending && <Icon name="sent" size={17} />}</button><button className="mail-compose-tool" type="button" aria-label="Discard draft" onClick={onClose}><Icon name="trash" size={19} /></button></footer>
      </form>
    </section>
  );
}

function MailboxScreen({ onExitPreview, preview = false, account = null, onLogout }) {
  const [messages, setMessages] = useState(preview ? previewMessages : []);
  const [mailFolders, setMailFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState("Inbox");
  const [selectedId, setSelectedId] = useState(preview ? "welcome" : "");
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileReading, setMobileReading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(!preview);
  const [mailError, setMailError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    document.title = "SPESS Mail";
  }, []);

  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    mailApi.getFolders()
      .then((payload) => { if (!cancelled) setMailFolders(payload?.folders || []); })
      .catch((error) => { if (!cancelled) setMailError(error.message); });
    return () => { cancelled = true; };
  }, [preview, refreshKey]);

  const activeFolderConfig = folders.find(([label]) => label === activeFolder) || folders[0];

  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoadingMessages(true);
      setMailError("");
      const folderId = activeFolder === "Starred" ? "" : activeFolderConfig[2];
      const searchQuery = [activeFolder === "Starred" ? "is:flagged" : "", query.trim()].filter(Boolean).join(" ");
      mailApi.getMessages({ folderId, query: searchQuery })
        .then((payload) => {
          if (cancelled) return;
          setMessages((payload?.messages || []).map((message) => normalizeLiveMessage(message)));
          setSelectedId("");
          setSelectedDetail(null);
          setMobileReading(false);
        })
        .catch((error) => { if (!cancelled) setMailError(error.message); })
        .finally(() => { if (!cancelled) setLoadingMessages(false); });
    }, 260);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeFolder, activeFolderConfig, preview, query, refreshKey]);

  const selected = selectedDetail || messages.find((message) => message.id === selectedId) || (preview ? messages[0] : null);
  const visibleMessages = useMemo(() => {
    if (!preview) return messages;
    const normalized = query.trim().toLowerCase();
    let next = messages;
    if (activeFolder === "Starred") next = next.filter((message) => message.starred);
    if (normalized) next = next.filter((message) => `${message.sender} ${message.subject} ${message.snippet}`.toLowerCase().includes(normalized));
    return next;
  }, [activeFolder, messages, preview, query]);

  const openMessage = async (id) => {
    setSelectedId(id);
    setMobileReading(true);
    setMessages((current) => current.map((message) => message.id === id ? { ...message, unread: false } : message));
    if (preview) return;
    setSelectedDetail(messages.find((message) => message.id === id) || null);
    try {
      const payload = await mailApi.getMessage(id);
      setSelectedDetail(normalizeLiveMessage(payload.message, true));
    } catch (error) {
      setMailError(error.message);
    }
  };

  const toggleStar = async (event, id) => {
    event.stopPropagation();
    const currentMessage = messages.find((message) => message.id === id) || selected;
    const nextStarred = !currentMessage?.starred;
    setMessages((current) => current.map((message) => message.id === id ? { ...message, starred: nextStarred } : message));
    setSelectedDetail((current) => current?.id === id ? { ...current, starred: nextStarred } : current);
    if (!preview) {
      try {
        await mailApi.action(id, nextStarred ? "flag" : "!flag");
      } catch (error) {
        setMailError(error.message);
      }
    }
  };

  const actionSelected = async (operation) => {
    if (!selected || preview) return;
    try {
      await mailApi.action(selected.id, operation);
      setMessages((current) => current.filter((message) => message.id !== selected.id));
      setSelectedId("");
      setSelectedDetail(null);
      setMobileReading(false);
    } catch (error) {
      setMailError(error.message);
    }
  };

  const sendMessage = async (message) => {
    await mailApi.sendMessage(message);
    if (activeFolder === "Sent") setRefreshKey((value) => value + 1);
  };

  const displayName = account?.displayName || "Mail user";
  const profileInitials = displayInitials(displayName);

  return (
    <div className="mail-app-shell">
      <header className="mail-topbar">
        <button className="mail-menu-button" type="button" aria-label="Toggle folders" onClick={() => setSidebarOpen((open) => !open)}><Icon name="menu" /></button>
        <a className="mail-brand" href="/mail"><img src={badge} alt="" /><span>SPESS <strong>MAIL</strong></span></a>
        <label className="mail-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mail" /><kbd>/</kbd></label>
        <div className="mail-top-actions">
          {preview && <span className="mail-preview-pill">UI preview</span>}
          <button className="mail-profile-button" type="button" aria-label={`${displayName} account`} title={account?.email || displayName}><Avatar initials={profileInitials} tone="green" small /></button>
        </div>
      </header>

      <aside className={`mail-sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="mail-compose-button" type="button" onClick={() => { setReplyTo(null); setComposeOpen(true); }}><Icon name="compose" /> Compose</button>
        <nav aria-label="Mailbox folders">
          {folders.map(([label, icon, folderId, previewCount]) => {
            const liveFolder = mailFolders.find((folder) => folder.id === folderId);
            const count = preview ? previewCount : (label === "Inbox" ? liveFolder?.unread : liveFolder?.count);
            return (
            <button key={label} type="button" className={activeFolder === label ? "active" : ""} onClick={() => { setActiveFolder(label); setSidebarOpen(false); setMobileReading(false); }}>
              <Icon name={icon} size={19} /> <span>{label}</span>{count ? <strong>{count}</strong> : null}
            </button>
            );
          })}
        </nav>
        <div className="mail-labels"><p>Labels <button type="button" aria-label="Add label">+</button></p><span><i className="academic" /> Academic</span><span><i className="school" /> School</span><span><i className="community" /> Community</span></div>
        <div className="mail-storage"><div><span>Mailbox storage</span><strong>0.2 GB of 2 GB</strong></div><div className="mail-storage-track"><i /></div></div>
        <button className="mail-exit-preview" type="button" onClick={preview ? onExitPreview : onLogout}><Icon name="logout" size={18} /> {preview ? "Exit preview" : "Sign out"}</button>
      </aside>
      {sidebarOpen && <button className="mail-sidebar-scrim" type="button" aria-label="Close folders" onClick={() => setSidebarOpen(false)} />}

      <main className={`mail-workspace ${mobileReading ? "mobile-reading" : ""}`}>
        <section className="mail-list-pane" aria-label={`${activeFolder} messages`}>
          <div className="mail-pane-header">
            <div><span className="mail-section-kicker">Mailbox</span><h1>{activeFolder}</h1></div>
            <div className="mail-list-actions"><button type="button" aria-label="Refresh" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /></button><button type="button" aria-label="More actions"><Icon name="more" /></button></div>
          </div>
          <div className="mail-list-meta"><label><input type="checkbox" /> Select all</label><span>{visibleMessages.length} messages</span></div>
          <div className="mail-message-list">
            {mailError && <div className="mail-inline-error" role="alert">{mailError}</div>}
            {loadingMessages ? <div className="mail-empty"><span className="mail-loading-ring" /><h2>Loading mail…</h2></div> : visibleMessages.length ? visibleMessages.map((message) => (
              <article key={message.id} className={`mail-row ${message.unread ? "unread" : ""} ${selected?.id === message.id ? "selected" : ""}`} onClick={() => openMessage(message.id)}>
                <button className={`mail-star ${message.starred ? "on" : ""}`} type="button" aria-label={message.starred ? "Remove star" : "Add star"} onClick={(event) => toggleStar(event, message.id)}><Icon name="star" size={18} /></button>
                <Avatar initials={message.initials} tone={message.tone} />
                <div className="mail-row-copy"><div><strong>{message.sender}</strong><time>{message.time}</time></div><h2>{message.subject}</h2><p>{message.snippet}</p><span className="mail-row-label">{message.label}</span></div>
              </article>
            )) : <div className="mail-empty"><Icon name="inbox" size={34} /><h2>No messages found</h2><p>Try a different search or folder.</p></div>}
          </div>
        </section>

        <section className="mail-reader-pane" aria-label="Message reader">
          {selected ? (
            <>
              <div className="mail-reader-toolbar">
                <button className="mail-mobile-back" type="button" aria-label="Back to inbox" onClick={() => setMobileReading(false)}><Icon name="back" /></button>
                <button type="button" aria-label="Archive" onClick={() => actionSelected("archive")}><Icon name="archive" /></button><button type="button" aria-label="Report spam" onClick={() => actionSelected("spam")}><Icon name="alert" /></button><button type="button" aria-label="Delete" onClick={() => actionSelected("trash")}><Icon name="trash" /></button><span /><button type="button" aria-label="More actions"><Icon name="more" /></button>
              </div>
              <article className="mail-reader-content">
                <div className="mail-reader-heading"><span className="mail-reader-label">{selected.label}</span><h1>{selected.subject}</h1></div>
                <div className="mail-reader-sender"><Avatar initials={selected.initials} tone={selected.tone} /><div><strong>{selected.sender}</strong><span>&lt;{selected.email}&gt;</span><small>to me</small></div><time>{selected.time}</time><button type="button" aria-label={selected.starred ? "Remove star" : "Add star"} className={selected.starred ? "on" : ""} onClick={(event) => toggleStar(event, selected.id)}><Icon name="star" size={19} /></button></div>
                <div className="mail-reader-body">
                  {(selected.body || [selected.snippet]).map((paragraph, index) => <p key={`${selected.id}-${index}`}>{paragraph}</p>)}
                  {selected.id === "welcome" && <div className="mail-welcome-card"><img src={badge} alt="" /><div><span>St. Phillip’s Equatorial SS</span><strong>Your official school email</strong></div><Icon name="shield" /></div>}
                </div>
                <div className="mail-reader-response"><button type="button" onClick={() => { setReplyTo(selected); setComposeOpen(true); }}><Icon name="reply" /> Reply</button><button type="button" onClick={() => { setReplyTo(null); setComposeOpen(true); }}><Icon name="forward" /> Forward</button></div>
              </article>
            </>
          ) : <div className="mail-reader-empty"><Icon name="inbox" size={42} /><h2>Select a message</h2><p>Your message will open here.</p></div>}
        </section>
      </main>

      <button className="mail-mobile-compose" type="button" aria-label="Compose" onClick={() => { setReplyTo(null); setComposeOpen(true); }}><Icon name="compose" /></button>
      {composeOpen && <ComposeWindow preview={preview} replyTo={replyTo} onSend={sendMessage} onClose={() => { setComposeOpen(false); setReplyTo(null); }} />}
    </div>
  );
}

export default function SpessMail() {
  const previewRequested = new URLSearchParams(window.location.search).get("preview") === "1";
  const [mode, setMode] = useState(previewRequested ? "preview" : "loading");
  const [account, setAccount] = useState(null);
  const [activationAvailable, setActivationAvailable] = useState(false);

  useEffect(() => {
    document.title = mode === "live" || mode === "preview" ? "Inbox · SPESS Mail" : "SPESS Mail";
  }, [mode]);

  useEffect(() => {
    if (previewRequested) return;
    let cancelled = false;
    Promise.allSettled([mailApi.getSession(), mailApi.getActivationStatus()]).then(([sessionResult, activationResult]) => {
      if (cancelled) return;
      if (activationResult.status === "fulfilled") setActivationAvailable(Boolean(activationResult.value?.available));
      if (sessionResult.status === "fulfilled") {
        setAccount(sessionResult.value?.account || null);
        setMode("live");
      } else {
        setMode("entry");
      }
    });
    return () => { cancelled = true; };
  }, [previewRequested]);

  const handleLogin = async (credentials) => {
    const payload = await mailApi.login(credentials);
    setAccount(payload?.account || null);
    setMode("live");
  };

  const handleLogout = async () => {
    try {
      await mailApi.logout();
    } finally {
      setAccount(null);
      setMode("entry");
    }
  };

  if (mode === "loading") {
    return <div className="mail-session-loading"><img src={badge} alt="" /><span className="mail-loading-ring" /><strong>Opening SPESS Mail…</strong></div>;
  }

  if (mode === "preview") {
    return <MailboxScreen preview onExitPreview={() => setMode("entry")} />;
  }

  if (mode === "live") {
    return <MailboxScreen account={account} onLogout={handleLogout} />;
  }

  return <EntryScreen activationAvailable={activationAvailable} onLogin={handleLogin} onPreview={() => setMode("preview")} />;
}

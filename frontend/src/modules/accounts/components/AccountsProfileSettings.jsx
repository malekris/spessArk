import { useRef, useState } from "react";
import { accountsRequest } from "../api";

const getInitials = (name) => String(name || "Bursar")
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.slice(0, 1).toUpperCase())
  .join("") || "B";

export default function AccountsProfileSettings({ user, onProfileChange }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [photoMessage, setPhotoMessage] = useState({ type: "", text: "" });
  const [passwordMessage, setPasswordMessage] = useState({ type: "", text: "" });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoMessage({ type: "error", text: "Choose a JPG, PNG, or WebP photo." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoMessage({ type: "error", text: "Profile photo must be 5 MB or smaller." });
      return;
    }

    try {
      setUploading(true);
      setPhotoMessage({ type: "", text: "" });
      const formData = new FormData();
      formData.append("avatar", file);
      const body = await accountsRequest("/profile/avatar", {
        method: "PUT",
        body: formData,
      });
      onProfileChange({ ...user, avatar_url: body.avatar_url });
      setPhotoMessage({ type: "success", text: "Profile photo updated." });
    } catch (error) {
      setPhotoMessage({ type: "error", text: error.message || "Failed to update profile photo." });
    } finally {
      setUploading(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordMessage({ type: "", text: "" });
    if (passwords.next !== passwords.confirm) {
      setPasswordMessage({ type: "error", text: "The new passwords do not match." });
      return;
    }

    try {
      setChangingPassword(true);
      const body = await accountsRequest("/profile/password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: passwords.current,
          new_password: passwords.next,
        }),
      });
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordMessage({ type: "success", text: body.message });
    } catch (error) {
      setPasswordMessage({ type: "error", text: error.message || "Failed to change password." });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <section className="accounts-settings-panel" aria-labelledby="accounts-settings-title">
      <header className="accounts-settings-header">
        <span>Your account</span>
        <h2 id="accounts-settings-title">Profile & Security</h2>
        <p>Keep your Accounts identity and sign-in details up to date.</p>
      </header>

      <div className="accounts-settings-layout">
        <section className="accounts-profile-editor" aria-labelledby="accounts-profile-photo-title">
          <div className="accounts-settings-section-copy">
            <span>Profile</span>
            <h3 id="accounts-profile-photo-title">Profile photo</h3>
          </div>
          <div className="accounts-avatar-editor">
            <div className="accounts-profile-avatar is-large">
              {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{getInitials(user?.name)}</span>}
            </div>
            <div>
              <strong>{user?.name || "Bursar"}</strong>
              <small>{user?.email || user?.username}</small>
              <input
                ref={fileInputRef}
                className="accounts-visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={uploadPhoto}
              />
              <button
                type="button"
                className="accounts-profile-action"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading..." : user?.avatar_url ? "Change photo" : "Add photo"}
              </button>
            </div>
          </div>
          {photoMessage.text ? (
            <div className={`accounts-settings-message is-${photoMessage.type}`} role="status">{photoMessage.text}</div>
          ) : null}
        </section>

        <form className="accounts-password-editor" onSubmit={changePassword}>
          <div className="accounts-settings-section-copy">
            <span>Security</span>
            <h3>Change password</h3>
          </div>
          <label><span>Current password</span><input type="password" autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))} /></label>
          <label><span>New password</span><input type="password" minLength="12" autoComplete="new-password" value={passwords.next} onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))} /></label>
          <label><span>Confirm new password</span><input type="password" minLength="12" autoComplete="new-password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} /></label>
          {passwordMessage.text ? (
            <div className={`accounts-settings-message is-${passwordMessage.type}`} role="status">{passwordMessage.text}</div>
          ) : null}
          <button type="submit" className="accounts-primary-button" disabled={changingPassword}>
            {changingPassword ? "Changing..." : "Change password"}
          </button>
        </form>
      </div>
    </section>
  );
}

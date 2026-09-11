import { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function DirectChatPet({ conversationId, token, pet, onUpdated }) {
  const [name, setName] = useState(pet?.pet_name || "Sprout");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setName(pet?.pet_name || "Sprout");
  }, [pet?.pet_name]);

  const progress = useMemo(() => {
    if (!pet?.adopted) return 0;
    const nextAt = Number(pet?.stage?.nextAt || 0);
    if (!nextAt) return 100;
    return Math.min(100, Math.round((Number(pet.growth_count || 0) / nextAt) * 100));
  }, [pet]);

  const savePet = async (event) => {
    event.preventDefault();
    const petName = name.trim();
    if (!conversationId || !petName || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/dms/conversations/${conversationId}/pet`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pet_name: petName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update your chat pet");
      onUpdated?.(data);
      setNotice(pet?.adopted ? "New name saved for both of you." : "Your shared pet is here. Messages will help it grow.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`dm-chat-pet ${pet?.adopted ? `stage-${pet?.stage?.key || "seed"}` : "not-adopted"}`} aria-labelledby="dm-chat-pet-title">
      <div className="dm-chat-pet-visual" aria-hidden="true">
        <span>{pet?.adopted ? pet?.stage?.emoji || "🌱" : "🪴"}</span>
        <i />
      </div>
      <div className="dm-chat-pet-body">
        <div className="dm-chat-pet-heading">
          <div><span>Shared Chat Pet</span><strong id="dm-chat-pet-title">{pet?.adopted ? pet.pet_name : "Grow something together"}</strong></div>
          {pet?.adopted && <small>{pet?.stage?.label || "Seed"}</small>}
        </div>
        <p>{pet?.adopted ? "Every real message after adoption helps your plant reach its next stage." : "Adopt a tiny plant that grows from the conversations you share."}</p>
        {pet?.adopted && (
          <div className="dm-chat-pet-growth">
            <div><span style={{ width: `${progress}%` }} /></div>
            <small>{pet?.stage?.nextAt ? `${Math.max(0, Number(pet.stage.nextAt) - Number(pet.growth_count || 0))} messages to the next stage` : `${pet.growth_count || 0} messages grown together`}</small>
          </div>
        )}
        <form onSubmit={savePet}>
          <input value={name} onChange={(event) => setName(event.target.value.slice(0, 20))} maxLength={20} placeholder="Name your plant" disabled={!conversationId || busy} />
          <button type="submit" disabled={!conversationId || !name.trim() || busy || (pet?.adopted && name.trim() === pet.pet_name)}>{busy ? "Saving…" : pet?.adopted ? "Rename" : "Adopt plant"}</button>
        </form>
        {notice && <div className="dm-chat-pet-notice" role="status">{notice}</div>}
      </div>
    </section>
  );
}

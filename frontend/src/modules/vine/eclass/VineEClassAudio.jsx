import { useEffect, useRef } from "react";

export default function VineEClassAudio({ userId, stream, register, onPlayback }) {
  const ref = useRef(null);
  useEffect(() => {
    const audio = ref.current;
    let active = true;
    register(userId, audio);
    audio.srcObject = stream;
    audio.muted = false;
    audio.volume = 1;
    const play = () => {
      void audio.play().then(() => {
        if (active) onPlayback(userId, false);
      }).catch(() => {
        if (active) onPlayback(userId, true);
      });
    };
    const tracks = stream.getAudioTracks();
    tracks.forEach((track) => track.addEventListener("unmute", play));
    play();
    return () => {
      active = false;
      tracks.forEach((track) => track.removeEventListener("unmute", play));
      register(userId, null);
      audio.pause();
      audio.srcObject = null;
    };
  }, [onPlayback, register, stream, userId]);
  return <audio ref={ref} autoPlay playsInline data-eclass-user-id={userId} />;
}

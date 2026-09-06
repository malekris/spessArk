# Vine eClass audio deployment

Chat and microphone icons use Socket.IO. Audio uses separate browser-to-browser
WebRTC connections. Working chat does not prove those audio connections work.
STUN alone cannot connect every pair of mobile, school, or home networks.

## Required production fallback

Provision an authenticated TURN service outside the Render web service. Use the
provider's actual endpoints, including a TLS/TCP endpoint (typically port 443)
when supported, as well as UDP. Do not point these at the Vine API URL.

Set these environment variables on the Render **backend**:

```dotenv
ECLASS_TURN_URLS=turn:YOUR_RELAY:3478?transport=udp,turns:YOUR_RELAY:443?transport=tcp
ECLASS_TURN_USERNAME=YOUR_TURN_USERNAME
ECLASS_TURN_CREDENTIAL=YOUR_TURN_PASSWORD
```

These are placeholders, not working credentials. Use TURN credentials, not the
provider's account API key. Choose a provider with renewable/static TURN
credentials for this mode; don't paste an expiring one-time token and forget it.

For coturn or a compatible TURN REST shared-secret server, set
`ECLASS_TURN_SHARED_SECRET` instead of username/password. Vine creates signed
24-hour credentials for each authenticated member. The shared secret stays on
the backend. Provider-specific credential-generation APIs need a separate
integration; their API keys are not TURN passwords.

Deploy backend and frontend changes. Relay settings are delivered in the
authorized `eclass_join` acknowledgement, not polled and not publicly exposed
through an HTTP endpoint. Existing `VITE_TURN_*` build-time configuration remains
a fallback for older deployments, but server-managed settings are preferred.
Restart the backend after changing its environment and rejoin the class.

Without valid relay configuration, direct audio still works on compatible
networks, but moderators see a warning. A configured relay is not proof its
credentials, ports, or quota are working: complete the cross-network test below.

## Acceptance checks before a full class

1. Use headphones for the test, with the teacher on Wi-Fi and a learner on mobile
   data. Two devices playing speakers beside one another can cause echo
   cancellation to suppress speech.
2. Both participants must show audio connected. The learner joins muted; unmute
   them, speak in both directions, and confirm both can hear.
3. In Chrome's `chrome://webrtc-internals`, confirm increasing inbound and
   outbound audio RTP bytes/packets and nonzero audio energy while speaking.
   A successful media element `play()` call alone is not proof of received audio.
4. Test a restrictive network that selects a `relay` candidate, or temporarily
   force `iceTransportPolicy: "relay"` in a local diagnostic build. Check that
   audio works, then restore `all` for normal direct-first operation.
5. Test the Tap to hear control, moderator mute, learner unmute, screen sharing,
   leaving/rejoining, and switching between Wi-Fi and mobile data.
6. Check Render's delayed HTTP/WebSocket egress metrics and the TURN provider's
   separate usage/quota. No audio is proxied through the Express/Socket.IO server.
   Relayed audio consumes TURN bandwidth. This remains a mesh room: large classes
   require separate capacity testing, not just a successful two-person call.

References: https://webrtc.org/getting-started/turn-server and
https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

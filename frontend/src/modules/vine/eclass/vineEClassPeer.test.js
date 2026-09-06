import assert from "node:assert/strict";
import test from "node:test";
import { createEClassPeer, hasTurnRelay } from "./vineEClassPeer.js";

class FakePeer {
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  remoteDescription = null;
  candidates = [];
  descriptions = [];
  restarts = 0;
  async setLocalDescription() {
    const type = this.signalingState === "have-remote-offer" ? "answer" : "offer";
    this.localDescription = { type, sdp: "test" };
    this.signalingState = type === "answer" ? "stable" : "have-local-offer";
  }
  async setRemoteDescription(description) {
    this.descriptions.push(description);
    await Promise.resolve();
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(candidate) {
    assert.ok(this.remoteDescription);
    this.candidates.push(candidate);
  }
  restartIce() { this.restarts += 1; }
  close() { this.signalingState = "closed"; }
}

const setup = (myId = 1) => {
  const states = [], sent = [], errors = [], callbacks = new Map();
  let timerId = 0;
  const peer = createEClassPeer({
    myId, remoteUserId: myId === 1 ? 2 : 1,
    PeerConnection: FakePeer,
    timers: { setTimeout(fn, delay) { const id = ++timerId; callbacks.set(id, { fn, delay }); return id; }, clearTimeout(id) { callbacks.delete(id); } },
    sendSignal: (signal) => sent.push(signal), onState: (state) => states.push(state),
    onTrack() {}, onError: (error) => errors.push(error),
  });
  return { peer, pc: peer.pc, states, sent, errors, callbacks };
};

test("TURN availability requires relay URLs and credentials, not just STUN", () => {
  assert.equal(hasTurnRelay({ iceServers: [{ urls: "stun:stun.example" }] }), false);
  assert.equal(hasTurnRelay({ iceServers: [{ urls: "turn:relay.example" }] }), false);
  assert.equal(hasTurnRelay({ iceServers: [{ urls: ["turns:relay.example:443"], username: "u", credential: "p" }] }), true);
});

test("queues early ICE and serializes concurrent SDP and ICE callbacks", async () => {
  const { peer, pc, errors } = setup();
  await peer.receive({ candidate: { candidate: "early" } });
  await Promise.all([
    peer.receive({ description: { type: "offer", sdp: "offer" } }),
    peer.receive({ candidate: { candidate: "late" } }),
  ]);
  assert.deepEqual(pc.candidates.map((c) => c.candidate), ["early", "late"]);
  assert.equal(pc.signalingState, "stable");
  assert.deepEqual(errors, []);
  peer.close();
});

test("impolite peer ignores a colliding offer and its candidates", async () => {
  const { peer, pc, errors } = setup(1);
  await pc.onnegotiationneeded();
  await peer.receive({ description: { type: "offer", sdp: "collision" } });
  await peer.receive({ candidate: { candidate: "ignored" } });
  assert.equal(pc.descriptions.length, 0);
  assert.equal(pc.candidates.length, 0);
  await peer.receive({ description: { type: "answer", sdp: "accepted" } });
  await peer.receive({ candidate: { candidate: "accepted" } });
  assert.equal(pc.signalingState, "stable");
  assert.equal(pc.candidates.length, 1);
  assert.deepEqual(errors, []);
  peer.close();
});

test("polite peer accepts the colliding offer and sends an answer", async () => {
  const { peer, pc, sent } = setup(2);
  await pc.onnegotiationneeded();
  await peer.receive({ description: { type: "offer", sdp: "collision" } });
  assert.equal(sent.at(-1).description.type, "answer");
  assert.equal(pc.signalingState, "stable");
  peer.close();
});

test("unconnected peers time out visibly and closed peers cancel all recovery", async () => {
  const { peer, pc, states, callbacks } = setup();
  callbacks.values().next().value.fn();
  assert.equal(states.at(-1), "failed");
  pc.connectionState = "failed";
  pc.onconnectionstatechange();
  peer.close();
  assert.equal(callbacks.size, 0);
  peer.restart();
  await peer.receive({ description: { type: "offer" } });
  assert.equal(pc.restarts, 0);
  assert.equal(pc.descriptions.length, 0);
});

test("recovery is bounded and connection success clears pending timers", () => {
  const { peer, pc, callbacks, states } = setup();
  for (let i = 0; i < 3; i += 1) {
    pc.connectionState = "failed";
    pc.onconnectionstatechange();
    for (const [id, timer] of callbacks) {
      if (timer.delay === 500) { callbacks.delete(id); timer.fn(); }
    }
  }
  assert.equal(pc.restarts, 2);
  pc.connectionState = "connected";
  pc.onconnectionstatechange();
  assert.equal(states.at(-1), "connected");
  assert.equal(callbacks.size, 0);
  peer.close();
});

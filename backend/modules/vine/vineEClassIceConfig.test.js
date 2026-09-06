import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createCloudflareTurnClient, getEClassIceConfig } from "./vineEClassIceConfig.js";

test("missing or incomplete TURN configuration keeps direct connections available", async () => {
  for (const env of [{}, { ECLASS_TURN_URLS: "turn:relay.example:3478" }, {
    ECLASS_TURN_URLS: "https://invalid.example", ECLASS_TURN_USERNAME: "user", ECLASS_TURN_CREDENTIAL: "password",
  }]) {
    const config = await getEClassIceConfig(12, env);
    assert.equal(config.iceServers.length, 2);
    assert.equal(config.iceTransportPolicy, "all");
  }
});

test("authenticated joins receive configured UDP and TLS relay endpoints", async () => {
  const config = await getEClassIceConfig(12, {
    ECLASS_TURN_URLS: " turn:relay.example:3478?transport=udp, turns:relay.example:443?transport=tcp ",
    ECLASS_TURN_USERNAME: "user", ECLASS_TURN_CREDENTIAL: "password",
  });
  assert.deepEqual(config.iceServers[2], {
    urls: ["turn:relay.example:3478?transport=udp", "turns:relay.example:443?transport=tcp"],
    username: "user", credential: "password",
  });
});

test("shared-secret mode issues expiring user credentials without exposing the secret", async () => {
  const env = { ECLASS_TURN_URLS: "turn:relay.example:3478", ECLASS_TURN_SHARED_SECRET: "private-test-key" };
  const server = (await getEClassIceConfig(12, env, 1_000_000)).iceServers[2];
  assert.equal(server.username, "87400:12");
  assert.equal(server.credential, createHmac("sha1", env.ECLASS_TURN_SHARED_SECRET).update(server.username).digest("base64"));
  assert.ok(!JSON.stringify(server).includes(env.ECLASS_TURN_SHARED_SECRET));
  assert.notEqual(server.credential, (await getEClassIceConfig(13, env, 1_000_000)).iceServers[2].credential);
});

const keyId = "a".repeat(32);
const upstream = () => ({
  ok: true,
  async json() {
    return { iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary-user", credential: "temporary-password" },
    ] };
  },
});

test("Cloudflare key is exchanged server-side and only temporary credentials are returned", async () => {
  let called = 0;
  const load = createCloudflareTurnClient({ fetchImpl: async (url, options) => {
    called += 1;
    assert.equal(url, `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer permanent-private-token");
    assert.deepEqual(JSON.parse(options.body), { ttl: 86400 });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return upstream();
  } });
  const config = await load(12, keyId, "permanent-private-token");
  assert.equal(called, 1);
  assert.equal(config.iceTransportPolicy, "all");
  assert.equal(config.iceServers[1].credential, "temporary-password");
  assert.ok(!JSON.stringify(config).includes("permanent-private-token"));
  assert.ok(!config.iceServers.some((s) => s.urls.some((u) => u.includes(":53"))));
});

test("reconnects and concurrent joins reuse credentials without sharing across users", async () => {
  let called = 0, time = 1000;
  const load = createCloudflareTurnClient({ now: () => time, fetchImpl: async () => { called += 1; return upstream(); } });
  const first = await Promise.all([load(12, keyId, "token"), load(12, keyId, "token")]);
  assert.equal(called, 1);
  first[0].iceServers[1].credential = "changed-by-caller";
  assert.equal((await load(12, keyId, "token")).iceServers[1].credential, "temporary-password");
  await load(13, keyId, "token");
  assert.equal(called, 2);
  await load(12, keyId, "rotated-token");
  assert.equal(called, 3);
  time += 300001;
  await load(12, keyId, "token");
  assert.equal(called, 4);
});

test("provider failures are sanitized and backed off, not silently treated as working relay", async () => {
  let called = 0, time = 0;
  const load = createCloudflareTurnClient({ now: () => time, fetchImpl: async () => {
    called += 1;
    throw new Error("private-provider-response-containing-a-token");
  } });
  for (const userId of [12, 13, 14]) {
    await assert.rejects(load(userId, keyId, "token"), { message: "The audio relay is unavailable. Please try joining again shortly." });
  }
  assert.equal(called, 1);
  time = 15001;
  await assert.rejects(load(12, keyId, "token"));
  assert.equal(called, 2);
});

test("rejects invalid settings, rejected credentials, and STUN-only responses", async () => {
  await assert.rejects(getEClassIceConfig(12, { ECLASS_CLOUDFLARE_TURN_KEY_ID: keyId }));
  const badResponses = [{ ok: false }, { ok: true, json: async () => ({}) }, {
    ok: true, json: async () => ({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "turn:turn.cloudflare.com:3478" }] }),
  }];
  for (const response of badResponses) {
    const load = createCloudflareTurnClient({ fetchImpl: async () => response });
    await assert.rejects(load(12, keyId, "token"));
  }
});

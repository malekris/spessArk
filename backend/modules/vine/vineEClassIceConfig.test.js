import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { getEClassIceConfig } from "./vineEClassIceConfig.js";

test("missing or incomplete TURN configuration keeps direct connections available", () => {
  for (const env of [{}, { ECLASS_TURN_URLS: "turn:relay.example:3478" }, {
    ECLASS_TURN_URLS: "https://invalid.example", ECLASS_TURN_USERNAME: "user", ECLASS_TURN_CREDENTIAL: "password",
  }]) {
    const config = getEClassIceConfig(12, env);
    assert.equal(config.iceServers.length, 2);
    assert.equal(config.iceTransportPolicy, "all");
  }
});

test("authenticated joins receive configured UDP and TLS relay endpoints", () => {
  const config = getEClassIceConfig(12, {
    ECLASS_TURN_URLS: " turn:relay.example:3478?transport=udp, turns:relay.example:443?transport=tcp ",
    ECLASS_TURN_USERNAME: "user", ECLASS_TURN_CREDENTIAL: "password",
  });
  assert.deepEqual(config.iceServers[2], {
    urls: ["turn:relay.example:3478?transport=udp", "turns:relay.example:443?transport=tcp"],
    username: "user", credential: "password",
  });
});

test("shared-secret mode issues expiring user credentials without exposing the secret", () => {
  const env = { ECLASS_TURN_URLS: "turn:relay.example:3478", ECLASS_TURN_SHARED_SECRET: "private-test-key" };
  const server = getEClassIceConfig(12, env, 1_000_000).iceServers[2];
  assert.equal(server.username, "87400:12");
  assert.equal(server.credential, createHmac("sha1", env.ECLASS_TURN_SHARED_SECRET).update(server.username).digest("base64"));
  assert.ok(!JSON.stringify(server).includes(env.ECLASS_TURN_SHARED_SECRET));
  assert.notEqual(server.credential, getEClassIceConfig(13, env, 1_000_000).iceServers[2].credential);
});

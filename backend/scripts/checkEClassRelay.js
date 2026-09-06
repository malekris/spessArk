import "../config/env.js";
import { getEClassIceConfig } from "../modules/vine/vineEClassIceConfig.js";

try {
  const config = await getEClassIceConfig(0);
  const relayUrls = config.iceServers.flatMap((server) => server.username && server.credential
    ? [server.urls].flat().filter((url) => /^turns?:/i.test(url)) : []);
  if (!relayUrls.length) throw new Error("No authenticated TURN relay is configured.");
  console.log(`TURN credential check passed: ${relayUrls.length} relay routes, TLS ${relayUrls.some((url) => /^turns:/i.test(url)) ? "available" : "not configured"}.`);
  console.log("No credentials printed. A cross-network audio test is still required.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

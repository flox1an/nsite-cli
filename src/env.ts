import "dotenv/config";

const NOSTR_RELAYS = process.env.NOSTR_RELAYS?.split(",") ?? [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
];
const BLOSSOM_SERVERS = process.env.BLOSSOM_SERVERS?.split(",") ?? ["https://media-server.slidestr.net"];

const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY || "";

if (NOSTR_RELAYS.length === 0) throw new Error("Requires at least one relay in NOSTR_RELAYS");

export { NOSTR_RELAYS, BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY };

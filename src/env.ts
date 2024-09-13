import "dotenv/config";

const NOSTR_RELAYS = process.env.NOSTR_RELAYS?.split(",") ?? [];

// https://cdn.nostrcheck.me does not allow html
const BLOSSOM_SERVERS = process.env.BLOSSOM_SERVERS?.split(",") ?? [];

const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY || "";

if (NOSTR_RELAYS.length === 0) throw new Error("Requires at least one relay in NOSTR_RELAYS");

export { NOSTR_RELAYS, BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY };


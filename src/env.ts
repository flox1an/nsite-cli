import "dotenv/config";

const NOSTR_RELAYS = process.env.NOSTR_RELAYS?.split(",") ?? [];

const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY || "";

const BLOSSOM_SERVERS = process.env.BLOSSOM_SERVERS?.split(",") ?? [];

export { NOSTR_RELAYS, BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY };

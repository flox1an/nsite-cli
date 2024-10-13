import "dotenv/config";

const NOSTR_RELAYS = process.env.NOSTR_RELAYS?.split(",") ?? [];

const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY || "";

const BLOSSOM_SERVERS = process.env.BLOSSOM_SERVERS?.split(",") ?? [];

export { NOSTR_RELAYS, BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY };

export const PAC_PROXY = process.env.PAC_PROXY;
export const TOR_PROXY = process.env.TOR_PROXY;
export const I2P_PROXY = process.env.I2P_PROXY;

export const NSITE_BORADCAST_RELAYS = process.env.NSITE_BORADCAST_RELAYS?.split(",") || [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
];

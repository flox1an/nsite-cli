import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner, NDKRelay, NDKRelayList, NDKRelaySet } from "@nostr-dev-kit/ndk";
import { FileEntry, FileList } from "./types.js";
import { USER_BLOSSOM_SERVER_LIST_KIND } from "blossom-client-sdk";
import debug from "debug";
import { NSITE_BORADCAST_RELAYS, RELAY_DISCOVERY_RELAYS } from "./env.js";

const log = debug("nsite:nostr");

export const NSITE_KIND = 34128 as number;

export type Profile = {
  name?: string;
  about?: string;
  picture?: string;
  display_name?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  banner?: string;
};

async function fetchPublicFileEvents(ndk: NDK, pubKey: string): Promise<FileList> {
  const events = await ndk.fetchEvents({ kinds: [NSITE_KIND], authors: [pubKey] }, { closeOnEose: true });
  const files: FileList = [];

  events.forEach((e) => {
    const file = e.tagValue("d")?.replace(/^\//, "");
    const x = e.tagValue("x") || e.tagValue("sha256");
    if (file && x) {
      files.push({ event: e, localPath: file, remotePath: file, sha256: x, changedAt: e.created_at });
    }
  });

  return files;
}

export async function listRemoteFiles(ndk: NDK, pubKey: string): Promise<FileList> {
  const allEvents = await fetchPublicFileEvents(ndk, pubKey);

  return allEvents
    .reduce((acc, current) => {
      // Make sure we only have the newest event for each d=remotePath
      const existingFile = acc.find((file) => file.remotePath === current.remotePath);
      if (!existingFile || (existingFile.changedAt || 0) < (current.changedAt || 0)) {
        return [...acc.filter((file) => file.remotePath !== current.remotePath), current];
      }
      return acc;
    }, [] as FileEntry[])
    .sort((a, b) => {
      return a.remotePath > b.remotePath ? 1 : -1;
    });
}

export async function publishNSiteEvent(ndk: NDK, pubkey: string, path: string, sha256: string) {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  const e = new NDKEvent(ndk, {
    pubkey,
    kind: NSITE_KIND,
    content: "",
    created_at: Math.round(Date.now() / 1000), // TODO should we use file mtime here?
    tags: [
      ["d", path],
      ["x", sha256],
      ["client", "nsite-cli"],
    ],
  });

  await e.sign();
  await e.publish();

  log("Published", path, sha256);
}

export async function publishBlossomServerList(ndk: NDK, pubkey: string, servers: string[]) {
  const e = new NDKEvent(ndk, {
    pubkey,
    kind: USER_BLOSSOM_SERVER_LIST_KIND,
    content: "",
    created_at: Math.round(Date.now() / 1000),
    tags: [...servers.map((s) => ["server", s]), ["client", "nsite-cli"]],
  });

  await e.sign();
  await e.publish();

  log("Published blossom server list.", e.id);
}

function getBroadcastRelays(ndk: NDK) {
  const broadCastRelaySet = NDKRelaySet.fromRelayUrls([...NSITE_BORADCAST_RELAYS, ...ndk.pool.urls()], ndk);
  log("relays to broadcast to:", broadCastRelaySet.relayUrls);
  return broadCastRelaySet;
}

export async function broadcastRelayList(ndk: NDK, readRelayUrls: string[], writeRelayUrls: string[]) {
  const userRelayList = new NDKRelayList(ndk);
  userRelayList.readRelayUrls = Array.from(readRelayUrls);
  userRelayList.writeRelayUrls = Array.from(writeRelayUrls);

  const broadCastRelaySet = getBroadcastRelays(ndk);
  const relaysPosted = await userRelayList.publish(broadCastRelaySet);
  log(`relays posted to ${relaysPosted.size} relays`);
}

export async function publishProfile(ndk: NDK, profile: Profile) {
  if (!ndk.activeUser) return;
  const event = new NDKEvent(ndk, {
    kind: 0, // Kind 0 represents a profile metadata event
    content: JSON.stringify(profile), // Serialize the profile data into JSON
    created_at: Math.floor(Date.now() / 1000), // Timestamp in seconds
    tags: [],
    pubkey: ndk.activeUser.pubkey,
  });

  await event.sign(); // Sign the event with your private key (handled by NDK)

  const broadCastRelaySet = getBroadcastRelays(ndk);
  const profilePosted = await event.publish(broadCastRelaySet);
  log(`profile posted to ${profilePosted.size} relays`);
}

function removeRelayUrlPath(s: string) {
  return s.replace(/(ws:\/\/|wss:\/\/[^\/]+)\/?.*$/, '$1');
}

export async function fetchNip66ListOfRelayUrls() {
  const ndk = new NDK({ explicitRelayUrls: RELAY_DISCOVERY_RELAYS });
  ndk.connect();
  const events = await ndk.fetchEvents([{ kinds: [30166 as NDKKind] }], { closeOnEose: true });
  const uniqueRelayUrls = new Set(
    [...events.values()]
      .map((e) => e.tagValue("d"))
      .map((s) => s && removeRelayUrlPath(s)),
  );
  return ([...uniqueRelayUrls.values()].filter((s) => !!s) as string[]).sort();
}

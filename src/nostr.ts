import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { NSITE_KIND } from "./const.js";
import { FileEntry, FileList } from "./types.js";
import { USER_BLOSSOM_SERVER_LIST_KIND } from "blossom-client-sdk";

async function fetchPublicFileEvents(ndk: NDK, pubKey: string): Promise<FileList> {
  const events = await ndk.fetchEvents({ kinds: [NSITE_KIND], authors: [pubKey] }, { closeOnEose: true });
  const files: FileList = [];

  events.forEach((e) => {
    const file = e.tagValue("d")?.replace(/^\//, "");
    const x = e.tagValue("x") || e.tagValue("sha256");
    if (file && x) {
      files.push({ id: e.id, localPath: file, remotePath: file, sha256: x, changedAt: e.created_at });
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
  const e = new NDKEvent(ndk, {
    pubkey,
    kind: NSITE_KIND,
    content: "",
    created_at: Math.round(Date.now() / 1000),
    tags: [
      ["d", path],
      ["x", sha256],
      ["client", "nsite-cli"],
    ],
  });

  await e.sign();
  await e.publish();

  console.log("Published", path, sha256, e.sig, e.id);
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

  console.log("Published blossom server list.", e.id);
}

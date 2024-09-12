import NDK from "@nostr-dev-kit/ndk";
import { NSITE_KIND } from "./const.js";
import { FileEntry, FileList } from "./types.js";

async function fetchPublicFileEvents(ndk: NDK, pubKey: string): Promise<FileList> {
  return new Promise((resolve, reject) => {
    const sub = ndk.subscribe({ kinds: [NSITE_KIND], authors: [pubKey] }, {closeOnEose: true});
    const files: FileList = [];
    sub.on("event", (e) => {
      const file = e.tagValue("d")?.replace(/^\//, "");
      const x = e.tagValue("x") || e.tagValue("sha256");
      if (file && x) {
        files.push({ id: e.id, localPath: file, remotePath: file, sha256: x, changedAt: e.created_at });
      }
    });
    sub.on("eose", () => {
      resolve(files);
    });
  });
}

export async function listRemoteFiles(ndk: NDK, pubKey: string): Promise<FileList> {
  return (await fetchPublicFileEvents(ndk, pubKey))
    .reduce((acc, current) => {
      // Make sure we only have the newest event for each d=remotePath
      const existingFile = acc.find((file) => file.remotePath === current.remotePath);
      if (!existingFile || (existingFile.changedAt || 0) < (current.changedAt || 0)) {
        return [...acc.filter((file) => file.remotePath !== current.remotePath), current];
      }
      return acc;
    }, [] as FileEntry[])
    .sort((a, b) => {
      // Sort all remote files by path and change date
      if (a.remotePath === b.remotePath) {
        return (b.changedAt || 0) - (a.changedAt || 0);
      }
      return a.remotePath > b.remotePath ? 1 : -1;
    });
}

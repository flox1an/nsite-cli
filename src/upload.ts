import { EventTemplate, multiServerUpload, SignedEvent } from "blossom-client-sdk";
import { FileList } from "./types.js";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import { publishNSiteEvent } from "./nostr.js";
import debug from "debug";

const log = debug("nsite:upload");

export async function processUploads(
  ndk: NDK,
  filesToUpload: FileList,
  blossomServers: string[],
  signEventTemplate: (template: EventTemplate) => Promise<SignedEvent>,
) {
  const pubkey = ndk.activeUser?.pubkey;

  if (!pubkey) {
    throw new Error("User Pubkey not found.");
  }

  for await (const f of filesToUpload) {
    log("Publishing ", f.localPath, f.remotePath, f.sha256);
    const buffer = fs.readFileSync(f.localPath);
    const uploads = multiServerUpload(blossomServers, buffer, signEventTemplate);

    let published = false;
    for await (const { blob, progress, server } of uploads) {
      log("Uploaded", f.remotePath, `${server}/${blob}`);
      if (!published) {
        await publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
      }
    }
  }

  log("processUpload() ended.");
}

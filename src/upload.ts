import { multiServerUpload } from "blossom-client-sdk";
import { FileList } from "./types.js";
import { BLOSSOM_SERVERS } from "./env.js";
import { NSITE_KIND } from "./const.js";
import ndk, { signEventTemplate } from "./ndk.js";
import fs from "fs";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishNSiteEvent } from "./nostr.js";

export async function processUploads(filesToUpload: FileList, blossomServers: string[]) {
  const pubkey = ndk.activeUser?.pubkey;

  if (!pubkey) {
    throw new Error("User Pubkey not found.");
  }

  for await (const f of filesToUpload) {
    console.log("Publishing ", f.localPath, f.remotePath, f.sha256);
    const buffer = fs.readFileSync(f.localPath);
    const uploads = multiServerUpload(blossomServers, buffer, signEventTemplate);
    
    let published = false;
    for await (const { blob, progress, server } of uploads) {
      if (!published) {
        await publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
      }
    }
  };

  console.log("processUpload() ended.");
}

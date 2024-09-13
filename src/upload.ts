import { multiServerUpload } from "blossom-client-sdk";
import { FileList } from "./types.js";
import { BLOSSOM_SERVERS } from "./env.js";
import { NSITE_KIND } from "./const.js";
import ndk, { signEventTemplate } from "./ndk.js";
import fs from "fs";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishNSiteEvent } from "./nostr.js";

export async function processUploads(filesToUpload: FileList) {
  const pubkey = ndk.activeUser?.pubkey;

  if (!pubkey) {
    throw new Error("User Pubkey not found.");
  }

  for await (const f of filesToUpload) {
    console.log("Publishing ", f.localPath, f.remotePath, f.sha256);
    const buffer = fs.readFileSync(f.localPath);
    const upload = multiServerUpload(BLOSSOM_SERVERS, buffer, signEventTemplate);

    let published = false;
    for await (let { blob } of upload) {
      if (!published) {
        publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
      }
    }
  };

  // TODO this fire too early, somewhere an await is missing.
  console.log("processUpload() ended.");

}

import { EventTemplate, multiServerUpload, SignedEvent } from "blossom-client-sdk";
import { FileList } from "./types.js";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import { publishNSiteEvent } from "./nostr.js";
import debug from "debug";
import mime from "mime-types";

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

    const fileName = f.localPath.split("/").pop();
    if (!fileName) {
      throw new Error(`Could not determine file name for ${f.localPath}`);
    }

    const mimeType = mime.lookup(f.localPath) || "application/octet-stream";

    const file = new File([buffer], fileName, {
      type: mimeType,
      lastModified: f.changedAt,
    });

    const uploads = multiServerUpload(blossomServers, file, signEventTemplate);
    // TODO better error handling for 400, 402, 5xx ... for individual blossom servers
    // TODO also test for servers that are not accessible
    let published = false;
    for await (const { blob, progress, server } of uploads) {
      console.log("Uploaded", f.remotePath, `${server}/${blob}`);
      if (!published) {
        await publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
      }
    }
  }

  log("processUpload() ended.");
}

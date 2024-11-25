import { createUploadAuth, EventTemplate, getBlobSha256, SignedEvent } from "blossom-client-sdk";
import { multiServerUpload } from "blossom-client-sdk/actions/upload";
import NDK from "@nostr-dev-kit/ndk";
import debug from "debug";
import mime from "mime-types";

import { FileList } from "./types.js";
import fs from "fs";
import { publishNSiteEvent } from "./nostr.js";

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

    try {
      const uploads = await multiServerUpload(blossomServers, file, {
        onError(server, blob, error) {
          console.log("Error", f.remotePath, server, error.message);
        },
        onUpload(server, blob) {
          console.log("Uploaded", f.remotePath, `${server}/${getBlobSha256(blob)}`);
        },
        onAuth: (server, blob) => {
          console.log("Authenticating", f.remotePath, server);

          return createUploadAuth(signEventTemplate, blob);
        },
      });

      if (Array.from(uploads.values()).length > 0) {
        await publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
      }
    } catch (err) {
      console.error(`Error uploading '${file}'`, err);
    }
  }

  log("processUpload() ended.");
}

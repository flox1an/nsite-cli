import { multiServerUpload } from "blossom-client-sdk";
import { FileList } from "./types.js";
import { BLOSSOM_SERVERS } from "./env.js";
import { NSITE_KIND } from "./const.js";
import ndk, { signEventTemplate } from "./ndk.js";
import fs from "fs";
import { NDKEvent } from "@nostr-dev-kit/ndk";

export async function processUploads(filesToUpload: FileList) {
    
    const pubkey = ndk.activeUser?.pubkey;

    if (!pubkey) {
        throw new Error('User Pubkey not found.');
    }

    filesToUpload.forEach(async f => {
        console.log("Publishing ", f.localPath, f.remotePath, f.sha256);
        const buffer = fs.readFileSync(f.localPath);
        const upload = multiServerUpload(BLOSSOM_SERVERS, buffer, signEventTemplate);
  
        let published = false;
        for await (let { blob } of upload) {
          if (!published) {
            const e = new NDKEvent(ndk, {
              pubkey,
              kind: NSITE_KIND,
              content: "",
              created_at: Math.round(Date.now() / 1000),
              tags: [
                ["d", f.remotePath],
                ["x", f.sha256],
                ["client", "nsite-cli"]
              ],
            });
            
            await e.sign();
            await e.publish();
  
            console.log("Published", f.remotePath, f.sha256, e.sig, e.id);
          }
        }      
  
      });

      console.log('processUpload() ended.')
}
import { NDKEvent } from "@nostr-dev-kit/ndk";

export type FileEntry = {
  event?: NDKEvent;
  localPath: string;
  remotePath: string;
  sha256: string;
  changedAt?: number;
};

export type FileList = FileEntry[];

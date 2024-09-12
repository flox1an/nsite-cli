export type FileEntry = {
  id?: string;
  localPath: string;
  remotePath: string;
  sha256: string;
  changedAt?: number;
};

export type FileList = FileEntry[];

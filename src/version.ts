import denoConfig from "../deno.json" with { type: "json" };
export const version: string = denoConfig.version;

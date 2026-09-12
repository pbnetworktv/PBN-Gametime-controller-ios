import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src");
const output = path.join(root, "www");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const files = await readdir(output, { recursive: true });
if (!files.includes("index.html")) throw new Error("Build did not produce www/index.html.");
console.log(`PBN iOS web bundle built: ${files.length} files written to www/`);

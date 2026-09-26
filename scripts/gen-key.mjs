/**
 * Prints a fresh ENCRYPTION_KEY.
 *
 *   npm run gen:key
 *
 * Copy the output into .env.local and into your Vercel project. Changing it
 * later makes every value encrypted with the old key unreadable, so keep it
 * somewhere you will not lose it.
 */
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
console.log(key);
console.error(
  "\nAdd to .env.local (and to your Vercel project):\n  ENCRYPTION_KEY=" + key + "\n",
);

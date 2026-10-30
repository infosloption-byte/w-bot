import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./portal-auth.js";

const prisma = new PrismaClient();
async function main() {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const lines: string[] = [];
    for await (const line of rl) {
      lines.push(line);
      if (lines.length >= 3) break;
    }
    const email = lines[0]?.trim().toLowerCase();
    const password = lines[1];
    const displayName = lines[2]?.trim() || "Platform Administrator";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !password || password.length < 16 || password.length > 128 ||
        displayName.length > 100) {
      throw new Error("Enter email, secure password (16-128 characters), and optional display name on separate stdin lines");
    }
    // Bootstrap is deliberately local/CLI-only; no public admin registration.
    // A second invocation cannot create another initial super administrator.
    const count = await prisma.platformAdmin.count();
    if (count > 0) {
      throw new Error("A platform administrator already exists; bootstrap is disabled");
    }
    const passwordHash = await hashPassword(password);
    await prisma.platformAdmin.create({
      data: {
        email, displayName, passwordHash, role: "SUPER_ADMIN", active: true
      }
    });
    console.log("Initial platform administrator created. Password not printed.");
    return;
  }
  throw new Error("Supply credentials through protected stdin; do not pass passwords as CLI arguments");
}
main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : "Bootstrap failed");
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });

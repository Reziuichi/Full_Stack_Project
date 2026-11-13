import { withDb } from "@/server/db";
import type { SessionUser } from "@/lib/types";

export class EmailTakenError extends Error {}

export async function createUser(input: { name: string; email: string; passwordHash: string; emailVerifiedAt?: Date }): Promise<SessionUser> {
  return withDb(async (db) => {
    try {
      return await db.user.create({
        data: { name: input.name, email: input.email.toLowerCase(), passwordHash: input.passwordHash, emailVerifiedAt: input.emailVerifiedAt },
        select: { id: true, email: true, name: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new EmailTakenError("An account with this email already exists");
      throw error;
    }
  });
}

export async function emailInUse(email: string): Promise<boolean> {
  return withDb(async (db) => (await db.user.count({ where: { email: email.toLowerCase() } })) > 0);
}

/** The signed-in user after an emailed code: also records that the address is verified. */
export async function confirmUserEmail(id: string): Promise<SessionUser | null> {
  return withDb(async (db) => {
    const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, emailVerifiedAt: true } });
    if (!user) return null;
    if (!user.emailVerifiedAt) await db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    return { id: user.id, email: user.email, name: user.name };
  });
}

export async function findUserForLogin(email: string) {
  return withDb((db) =>
    db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, name: true, passwordHash: true },
    }),
  );
}

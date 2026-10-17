import type { Db } from "@/lib/db";
import { Prisma } from "@/lib/db";

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

/**
 * Records a significant administrative operation. Call it with the same
 * transaction client as the change so the audit trail and data stay consistent.
 * Never pass secrets, passwords or payment credentials in metadata.
 */
export async function recordAudit(db: Db, input: AuditInput) {
  await db.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

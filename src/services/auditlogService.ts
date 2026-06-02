import { pool } from "../config/database";

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  timestamp: Date;
}

export const auditService = {
  fetchAuditLogs: async (userId: string) => {
    //TODO Needs implementation
    return [
      {
        id: userId,
        userId: userId,
        action: "",
        timestamp: new Date(),
      },
    ];
  },
  updateAuditLog: async (log: AuditLog) => {
    //TODO Needs implementation
    throw new Error("Not yet implmented");
  },

  logPIIAccess: async (data: {
    adminId: string;
    targetId: string;
    resource: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: any;
  }) => {
    try {
      const query = `
        INSERT INTO pii_access_audit_logs (admin_id, target_id, resource, ip_address, user_agent, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await pool.query(query, [
        data.adminId,
        data.targetId,
        data.resource,
        data.ipAddress,
        data.userAgent,
        JSON.stringify(data.metadata || {}),
      ]);
      console.log(`[PII Audit] Logged access by ${data.adminId} on ${data.resource}:${data.targetId}`);
    } catch (error) {
      console.error("[PII Audit] Failed to log PII access:", error);
    }
  },
};

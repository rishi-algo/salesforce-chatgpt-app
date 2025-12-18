import { z } from "zod";
import { sfRequest } from "./salesforce.js";
import { getConnection } from "./vault.js";

const ObjEnum = z.enum(["Account", "Lead", "Opportunity", "Contact"]);
const EnvEnum = z.enum(["prod", "sandbox"]);

const ALLOW_FIELDS = {
  Opportunity: ["Id","Name","StageName","Amount","CloseDate","OwnerId","AccountId","Probability"],
  Lead: ["Id","Name","Company","Status","Rating","Email","Phone","OwnerId"],
  Account: ["Id","Name","Industry","Type","Website","Phone","OwnerId"],
  Contact: ["Id","Name","Email","Phone","Title","AccountId"]
};

export async function handleToolCall({ userKey, tool, input }) {
  if (tool === "salesforce_whoami") {
    const env = input?.env || "sandbox"; // you can store preferred env per user if you want
    const conn = getConnection({ userKey, env });
    if (!conn) return { error: { code: "NOT_CONNECTED", message: "Not connected. Run connect first." } };
    return { env, orgId: conn.orgId, instanceUrl: conn.instanceUrl, updatedAt: conn.updatedAt };
  }

  if (tool === "salesforce_search") {
    const schema = z.object({
      env: EnvEnum,
      query: z.string().min(2).max(120),
      objects: z.array(ObjEnum).min(1).max(4),
      limit: z.number().int().min(1).max(20).default(10)
    }).strict();
    const { env, query, objects, limit } = schema.parse(input);

    // Build SOSL safely
    const returning = objects.map(o => {
      const fields = ALLOW_FIELDS[o].filter(f => f !== "Id").slice(0, 6).join(",");
      return `${o}(Id,${fields})`;
    }).join(", ");

    const sosl = `FIND {${query.replace(/[{}]/g, "")}} IN NAME FIELDS RETURNING ${returning} LIMIT ${limit}`;
    const resp = await sfRequest({ userKey, env, method: "POST", path: "/search/", body: { search: sosl } });
    return resp.ok ? resp.json : { error: { code: "SF_ERROR", message: "Search failed", details: resp.json } };
  }

  if (tool === "salesforce_get_record") {
    const schema = z.object({
      env: EnvEnum,
      object: ObjEnum,
      id: z.string().regex(/^[a-zA-Z0-9]{15,18}$/),
      fields: z.array(z.string()).min(1).max(30)
    }).strict();
    const { env, object, id, fields } = schema.parse(input);

    const allowed = new Set(ALLOW_FIELDS[object]);
    const safeFields = fields.filter(f => allowed.has(f));
    if (safeFields.length === 0) return { error: { code: "VALIDATION_ERROR", message: "No allowed fields requested." } };

    const qs = encodeURIComponent(safeFields.join(","));
    const resp = await sfRequest({ userKey, env, method: "GET", path: `/sobjects/${object}/${id}?fields=${qs}` });
    return resp.ok ? resp.json : { error: { code: "SF_ERROR", message: "Get record failed", details: resp.json } };
  }

  if (tool === "salesforce_pipeline_summary") {
    const schema = z.object({
      env: EnvEnum,
      ownerId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional(),
      closeDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      closeDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }).strict();
    const { env, ownerId, closeDateFrom, closeDateTo } = schema.parse(input);

    const where = ["IsClosed=false"];
    if (ownerId) where.push(`OwnerId='${ownerId}'`);
    if (closeDateFrom) where.push(`CloseDate>=${closeDateFrom}`);
    if (closeDateTo) where.push(`CloseDate<=${closeDateTo}`);

    const soql =
      `SELECT StageName, COUNT(Id) cnt, SUM(Amount) amt ` +
      `FROM Opportunity WHERE ${where.join(" AND ")} GROUP BY StageName ORDER BY StageName`;

    const resp = await sfRequest({ userKey, env, method: "GET", path: `/query/?q=${encodeURIComponent(soql)}` });
    return resp.ok ? resp.json : { error: { code: "SF_ERROR", message: "Pipeline query failed", details: resp.json } };
  }

  if (tool === "salesforce_create_task") {
    const schema = z.object({
      env: EnvEnum,
      whatId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/),
      subject: z.string().min(3).max(255),
      activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.enum(["Low","Normal","High"]).default("Normal"),
      confirmed: z.literal(true) // require explicit confirmation
    }).strict();
    const payload = schema.parse(input);

    const body = {
      WhatId: payload.whatId,
      Subject: payload.subject,
      Priority: payload.priority,
      ...(payload.activityDate ? { ActivityDate: payload.activityDate } : {})
    };

    const resp = await sfRequest({ userKey, env, method: "POST", path: `/sobjects/Task/`, body });
    return resp.ok ? resp.json : { error: { code: "SF_ERROR", message: "Create Task failed", details: resp.json } };
  }

  return { error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${tool}` } };
}


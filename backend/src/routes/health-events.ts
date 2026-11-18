import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  deleteHealthEvent,
  eventFromExchange,
  exchangeForEvent,
  getHealthEvent,
  insertHealthEvent,
  listHealthEvents,
  type HealthEvent,
} from "../services/health-events.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { DEFAULT_WEB_SOURCES, MAX_WEB_SOURCES, getWebSources, setWebSources } from "../services/web-sources.js";

// ---------------------------------------------------------------------------
// The calendar of events a person accepted from official web sources, and the
// sources the search may use.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

/** An event, as the service returns it: one description, not two. */
const eventOut = z.custom<HealthEvent>((v) => typeof v === "object" && v !== null);
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourcesOut = z.object({ domains: z.array(z.string()), isDefault: z.boolean(), defaults: z.array(z.string()), max: z.number() });

async function requireUserId(req: { apiKey?: { id: string } | null; db: DbClient }): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

const healthEventRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/health-events",
    {
      schema: {
        summary: "The calendar: events around the network that a person accepted from official sources",
        description:
          "Earliest first. Each event carries its title, the dates the person validated, its place, the door by which " +
          "it reaches a health network (demand, capacity, access, care), the link to the source, a short quoted " +
          "passage, what the analyst had proposed for the dates, and who accepted it and when. `from` and `to` keep " +
          "the events that touch a period. Only accepted events exist: a candidate that was rejected is in no table.",
        tags: ["health-events"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ from: calendarDay.optional(), to: calendarDay.optional() }),
        response: { 200: z.object({ events: z.array(eventOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { events: await listHealthEvents(req.db, env.id, { from: req.query.from ?? null, to: req.query.to ?? null }) };
    },
  );

  app.post(
    "/ontology/:env/health-events",
    {
      schema: {
        summary: "Accept a candidate event into the calendar",
        description:
          "Records that the person asking accepted one of the candidates a search delivered. The body names the " +
          "journalled search (`exchangeId`, sent with the `done` line of `/analyst/events`), the candidate (`c1`, " +
          "`c2`, …) and the dates the person validated, which they may have corrected. The title, the place, the " +
          "door, the link and the quoted passage are copied by the server from that search: the caller sends none, " +
          "and a candidate the search did not deliver is refused. Accepting the same candidate twice is refused " +
          "(409). There is no route to reject: rejecting a candidate records nothing.",
        tags: ["health-events"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          exchangeId: z.string().uuid(),
          candidate: z.string().regex(/^c\d{1,3}$/),
          startsOn: calendarDay,
          endsOn: calendarDay.nullable().default(null),
        }),
        response: { 201: eventOut, 400: errorEnvelope, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const exchange = await exchangeForEvent(req.db, env.id, req.body.exchangeId);
      const draft = eventFromExchange(exchange, req.body.candidate, { startsOn: req.body.startsOn, endsOn: req.body.endsOn });
      const event = await insertHealthEvent(req.db, { projectId: env.id, exchangeId: req.body.exchangeId, userId, draft });
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "health_event.accept",
        resourceType: "health_event",
        resourceId: event.id,
        metadata: { title: event.title, startsOn: event.startsOn, endsOn: event.endsOn, source: event.sourceUrl },
      });
      return reply.code(201).send(event);
    },
  );

  app.delete(
    "/ontology/:env/health-events/:id",
    {
      schema: {
        summary: "Take an event out of the calendar",
        description:
          "Removes an accepted event, on a person's request. The analyst no longer sees it and the timeline no longer " +
          "shows it. The removal is kept in the audit log.",
        tags: ["health-events"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const event = await getHealthEvent(req.db, env.id, req.params.id);
      await deleteHealthEvent(req.db, env.id, event.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "health_event.remove",
        resourceType: "health_event",
        resourceId: event.id,
        metadata: { title: event.title, startsOn: event.startsOn, source: event.sourceUrl },
      });
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/ontology/:env/web-sources",
    {
      schema: {
        summary: "The web sources the analyst may search in this project",
        description:
          "A list of domains. The Claude API restricts its web search to them, and the server checks that every " +
          "candidate event cites a page inside them. `isDefault` is true when the project never set a list and the " +
          "starting one applies; `defaults` is that starting list.",
        tags: ["health-events"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: sourcesOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { ...(await getWebSources(req.db, env.id)), defaults: DEFAULT_WEB_SOURCES, max: MAX_WEB_SOURCES };
    },
  );

  app.put(
    "/ontology/:env/web-sources",
    {
      schema: {
        summary: "Set the web sources the analyst may search in this project",
        description:
          "Replaces the list. An entry is a bare domain, with an optional path and no scheme (`quebec.ca`, " +
          "`quebec.ca/sante`); a domain covers its subdomains. Plain ASCII only, no wildcard in the domain, at most " +
          "twenty entries. An empty list switches the search off for the project.",
        tags: ["health-events"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({ domains: z.array(z.string().max(200)).max(100) }),
        response: { 200: sourcesOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const saved = await setWebSources(req.db, env.id, userId, req.body.domains);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "web_sources.set",
        resourceType: "project",
        resourceId: env.id,
        metadata: { domains: saved.domains },
      });
      return { ...saved, defaults: DEFAULT_WEB_SOURCES, max: MAX_WEB_SOURCES };
    },
  );
};

export default healthEventRoutes;

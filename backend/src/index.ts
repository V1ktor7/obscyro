import "dotenv/config";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import authEnforce from "./plugins/auth-enforce.js";
import authIdentify from "./plugins/auth-identify.js";
import errorHandler from "./plugins/error-handler.js";
import pgPlugin from "./plugins/pg.js";
import rateLimitPlugin from "./plugins/rate-limit.js";
import requestLog from "./plugins/request-log.js";
import usagePlugin from "./plugins/usage.js";
import authRoutes from "./routes/auth.js";
import batchRoutes from "./routes/batch.js";
import conceptsRoutes from "./routes/concepts.js";
import disambiguateRoutes from "./routes/disambiguate.js";
import extractRoutes from "./routes/extract.js";
import healthRoutes from "./routes/health.js";
import hierarchyRoutes from "./routes/hierarchy.js";
import ingestRoutes from "./routes/ingest.js";
import normalizeRoutes from "./routes/normalize.js";
import onboardRoutes from "./routes/onboard.js";
import ontologyRoutes from "./routes/ontology.js";
import sourceRoutes from "./routes/source.js";
import synonymsRoutes from "./routes/synonyms.js";
import translateRoutes from "./routes/translate.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const isDev = process.env.NODE_ENV !== "production";

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,https://obscyro.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = Fastify({
  logger: {
    level: isDev ? "debug" : "info",
    transport: isDev
      ? {
          target: "pino-pretty",
          options: { translateTime: "HH:MM:ss Z", colorize: true },
        }
      : undefined,
  },
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Capture any non-JSON inbound body (e.g. webhook pushes of text/xml/binary) as
// a raw buffer so the webhook receiver can preserve it faithfully instead of
// dropping it. JSON keeps Fastify's default parser.
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, payload, done) => {
  done(null, payload);
});

await app.register(cors, {
  origin: corsOrigins,
  credentials: true,
});

await app.register(swagger, {
  openapi: {
    openapi: "3.1.0",
    info: {
      title: "Obscyro API",
      description: "Healthcare semantic interoperability API",
      version: "0.1.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "obs_live_...",
          description:
            "Obscyro API key. Mint one with `npm run create-key`. Send as `Authorization: Bearer obs_live_...`.",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "health", description: "Liveness and readiness probes" },
      { name: "concepts", description: "Concept lookup, synonyms, hierarchy" },
      { name: "hierarchy", description: "Parents, children, ancestors, descendants" },
      { name: "normalize", description: "Text → SNOMED matching" },
      { name: "translate", description: "Cross-terminology mappings" },
      { name: "extract", description: "Clinical concept and context extraction" },
      { name: "auth", description: "Platform login and API key management" },
      { name: "ingest", description: "REST and webhook data intake" },
      { name: "source", description: "Configurable HTTP request (server-side egress)" },
      { name: "ontology", description: "Object types and instances" },
      { name: "onboard", description: "Self-serve onboarding and account context" },
    ],
  },
  transform: jsonSchemaTransform,
});

await app.register(swaggerUi, { routePrefix: "/documentation" });

await app.register(pgPlugin);
await app.register(errorHandler);
await app.register(requestLog);

await app.register(authIdentify);
await app.register(rateLimitPlugin);
await app.register(authEnforce);
await app.register(usagePlugin);

await app.register(healthRoutes);
await app.register(authRoutes, { prefix: "/v1" });
await app.register(onboardRoutes, { prefix: "/v1" });
await app.register(ingestRoutes, { prefix: "/v1" });
await app.register(sourceRoutes, { prefix: "/v1" });
await app.register(ontologyRoutes, { prefix: "/v1" });
await app.register(conceptsRoutes, { prefix: "/v1" });
await app.register(synonymsRoutes, { prefix: "/v1" });
await app.register(hierarchyRoutes, { prefix: "/v1" });
await app.register(normalizeRoutes, { prefix: "/v1" });
await app.register(batchRoutes, { prefix: "/v1" });
await app.register(translateRoutes, { prefix: "/v1" });
await app.register(disambiguateRoutes, { prefix: "/v1" });
await app.register(extractRoutes, { prefix: "/v1" });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

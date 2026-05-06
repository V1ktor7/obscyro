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
import batchRoutes from "./routes/batch.js";
import conceptsRoutes from "./routes/concepts.js";
import disambiguateRoutes from "./routes/disambiguate.js";
import healthRoutes from "./routes/health.js";
import hierarchyRoutes from "./routes/hierarchy.js";
import normalizeRoutes from "./routes/normalize.js";
import synonymsRoutes from "./routes/synonyms.js";
import translateRoutes from "./routes/translate.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const isDev = process.env.NODE_ENV !== "production";

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

await app.register(cors);

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
await app.register(conceptsRoutes, { prefix: "/v1" });
await app.register(synonymsRoutes, { prefix: "/v1" });
await app.register(hierarchyRoutes, { prefix: "/v1" });
await app.register(normalizeRoutes, { prefix: "/v1" });
await app.register(batchRoutes, { prefix: "/v1" });
await app.register(translateRoutes, { prefix: "/v1" });
await app.register(disambiguateRoutes, { prefix: "/v1" });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

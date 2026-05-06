import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

import { AppError, envelope, NotFound } from "../lib/errors.js";

const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(envelope(err));
      return;
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const validation = new AppError(
        "VALIDATION_ERROR",
        "Request failed schema validation.",
        400,
        { issues: err.validation },
      );
      reply.status(400).send(envelope(validation));
      return;
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      const wrapped = new AppError(
        err.code ?? "BAD_REQUEST",
        err.message,
        err.statusCode,
      );
      reply.status(err.statusCode).send(envelope(wrapped));
      return;
    }

    req.log.error({ err }, "unhandled error");
    const internal = new AppError(
      "INTERNAL_ERROR",
      "An unexpected error occurred.",
      500,
    );
    reply.status(500).send(envelope(internal));
  });

  app.setNotFoundHandler((req, reply) => {
    const err = NotFound("NOT_FOUND", `Route ${req.method} ${req.url} not found.`);
    reply.status(404).send(envelope(err));
  });
}, {
  name: "obscyro-error-handler",
});

export default errorHandlerPlugin;

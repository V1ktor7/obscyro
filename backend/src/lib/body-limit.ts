/**
 * The body limit of the routes that receive a whole file.
 *
 * Fastify refuses any body over 1 MiB by default, and the API keeps that
 * default everywhere else (webhooks, small JSON). A CSV becomes larger once
 * its rows are sent as JSON objects, because every row repeats the column
 * names: a 0.5 MB file of 1,500 rows and 50 columns arrives as about 1.8 MiB.
 * The routes that take a file's rows, or a column of them, declare this
 * limit instead.
 */
export const FILE_BODY_LIMIT = 16 * 1024 * 1024;

# Obscyro's Postgres: Railway's image, plus PostGIS.
#
# The production database already runs Railway's own image
# (ghcr.io/railwayapp-templates/postgres-ssl), and that image's Dockerfile.18
# installs `postgresql-18-pgvector` — which is exactly why `vector` is in
# pg_extension on a database nobody deliberately gave pgvector to.
#
# It does not install PostGIS. That is the whole difference. So this is not a
# new database image, it is Railway's with one apt package added, which keeps
# everything the running deployment depends on:
#
#   - the TLS certificate that init-ssl.sh generates and rotates (SSL_CERT_DAYS
#     is in the service's variables today);
#   - pgbackrest, and the backups tab that reads it;
#   - wrapper.sh as the entrypoint, and the PGDATA layout beneath it.
#
# Rebuilding those from `postgres:18` would mean owning them. Adding a layer
# means not owning them.
#
# Verify the base tag before building — the public package listing showed tags
# only up to 17 when this was written, while the running database is 18.4:
#
#     docker manifest inspect ghcr.io/railwayapp-templates/postgres-ssl:18
#
# If it is not published, pin the exact minor the service reports instead. Do
# not fall back to `postgres:18`: that loses SSL and pgbackrest silently, and
# the failure would show up as a certificate error days later.

ARG POSTGRES_SSL_TAG=18
FROM ghcr.io/railwayapp-templates/postgres-ssl:${POSTGRES_SSL_TAG}

# PostGIS from PGDG, the same repository the base image takes pgvector from.
# `postgresql-18-postgis-3` pulls the library; `-scripts` carries the SQL the
# CREATE EXTENSION statements in a dump refer to. Installing the first without
# the second produces a restore that fails on the extension and nowhere else,
# which is a miserable thing to debug at 2 a.m.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        postgresql-18-postgis-3 \
        postgresql-18-postgis-3-scripts; \
    rm -rf /var/lib/apt/lists/*

# Fail the build rather than ship an image that is missing what it exists for.
# An image that starts fine and only reveals the gap when a restore hits
# CREATE EXTENSION is worse than one that never got built.
RUN set -eux; \
    for ext in postgis vector; do \
        test -f "/usr/share/postgresql/${PG_MAJOR}/extension/${ext}.control" \
          || { echo "missing extension: ${ext}"; exit 1; }; \
    done; \
    echo "postgis $(sed -n 's/^default_version *= *//p' \
        /usr/share/postgresql/${PG_MAJOR}/extension/postgis.control | tr -d \"'\")"; \
    echo "vector  $(sed -n 's/^default_version *= *//p' \
        /usr/share/postgresql/${PG_MAJOR}/extension/vector.control | tr -d \"'\")"

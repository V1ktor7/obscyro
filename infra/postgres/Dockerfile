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
# Pinned to 18.4, not 18, and the registry says why: on 7 August 2026 the tags
# `18` and `18.4` resolved to the same digest (sha256:268850e5d26b…, linux/amd64
# and linux/arm64 both published). So `18` *is* 18.4 today — and will silently
# become 18.5 the moment Railway publishes one.
#
# A floating tag under a database is the wrong kind of surprise. The minor bump
# should be a commit somebody made on purpose, on a day they chose.
#
# 18.4 is also exactly what production reports, which makes the move an image
# change and nothing else. Do not substitute `postgres:18` if a tag ever goes
# missing: that loses SSL and pgbackrest silently, and the failure would surface
# as a certificate error days later.

ARG POSTGRES_SSL_TAG=18.4
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

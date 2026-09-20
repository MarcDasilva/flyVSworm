# The exhibit's stateful half: relay.mjs (the ONLY process that can spend) and the fly model.
# The Vite front end is deployed separately to Vercel and reaches this container through the
# rewrites in wormed/web/vercel.json. Build context is the repo root.
FROM node:22-trixie

RUN apt-get update && apt-get install -y --no-install-recommends python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /venv \
 && /venv/bin/pip install --no-cache-dir numpy==2.5.3 fastapi==0.141.1 'uvicorn[standard]==0.53.0' \
 && npm install -g thru@0.3.16
# relay.mjs spawns `python3`; the venv must be what it finds.
ENV PATH=/venv/bin:$PATH

WORKDIR /app
COPY wormed/web/package.json wormed/web/package-lock.json wormed/web/
RUN cd wormed/web && npm ci --omit=dev
COPY wormed wormed
COPY fly-brain/python fly-brain/python
COPY fly-brain/spec fly-brain/spec
COPY fly-brain/web fly-brain/web
# pack_addr.py reads the program address out of docs/measurements.md at the repo root.
COPY docs/measurements.md docs/measurements.md

# The ledger lives on the mounted volume (fly.toml), which is what makes standings and the
# transaction total survive a redeploy — the container's own disk does not.
ENV EXHIBIT_DB=/data/exhibit.db
EXPOSE 8787
CMD ["sh", "wormed/serve.sh"]

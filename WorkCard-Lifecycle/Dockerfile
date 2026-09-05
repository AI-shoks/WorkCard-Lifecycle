FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

RUN npm install --global pnpm@11.19.0
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
RUN pnpm build
RUN pnpm --filter @work-card/api --prod deploy /opt/work-card
RUN cp -R apps/web/dist /opt/work-card/public

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:774b7d020b24214835769e24c3544835526cd0288f0b094eae48e8b2c2429a79 AS runtime

ENV APP_ENV=production \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PORT=3000 \
    WEB_DIST_PATH=/opt/work-card/public
WORKDIR /opt/work-card
COPY --from=build --chown=65532:65532 /opt/work-card ./

USER 65532:65532
ENTRYPOINT []
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]

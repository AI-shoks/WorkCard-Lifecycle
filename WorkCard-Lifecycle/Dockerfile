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

# Distroless's current Debian 13 image still carries libssl3t64 deb13u2.
# Install the exact Debian security package into the final image without a shell or apt.
ADD --checksum=sha256:ff16bc048bcd7d1b256094450b79c77947d8e76fe2a24bd99b91021d591fa074 \
  https://security.debian.org/debian-security/pool/updates/main/o/openssl/libssl3t64_3.5.7-1~deb13u3_amd64.deb \
  /tmp/libssl3t64.deb
RUN test "$(dpkg-deb -f /tmp/libssl3t64.deb Package)" = libssl3t64 \
    && test "$(dpkg-deb -f /tmp/libssl3t64.deb Version)" = '3.5.7-1~deb13u3' \
    && test "$(dpkg-deb -f /tmp/libssl3t64.deb Architecture)" = amd64 \
    && mkdir -p /opt/openssl-patch \
    && dpkg-deb -x /tmp/libssl3t64.deb /opt/openssl-patch \
    && dpkg-deb --ctrl-tarfile /tmp/libssl3t64.deb | tar -xOf - ./control > /opt/openssl-patch/libssl3t64.status \
    && test -s /opt/openssl-patch/libssl3t64.status \
    && test -s /opt/openssl-patch/usr/lib/x86_64-linux-gnu/libcrypto.so.3 \
    && test -s /opt/openssl-patch/usr/lib/x86_64-linux-gnu/libssl.so.3

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime

ARG APP_VERSION=0.1.0-dev
LABEL org.opencontainers.image.revision="${APP_VERSION}"

ENV APP_ENV=production \
    APP_VERSION="${APP_VERSION}" \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PORT=3000 \
    WEB_DIST_PATH=/opt/work-card/public
WORKDIR /opt/work-card
COPY --from=build /opt/openssl-patch/usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
COPY --from=build /opt/openssl-patch/usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=build /opt/openssl-patch/libssl3t64.status /var/lib/dpkg/status.d/libssl3t64
COPY --from=build --chown=65532:65532 /opt/work-card ./

USER 65532:65532
ENTRYPOINT []
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live',{signal:AbortSignal.timeout(2000)}).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]

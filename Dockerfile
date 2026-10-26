# Build stage: compile TypeScript from a clean checkout.
FROM node:26-trixie-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Runtime stage: production deps and Chromium baked in, so the first run downloads nothing.
FROM node:26-trixie-slim
LABEL io.modelcontextprotocol.server.name="io.github.eduard256/shopper-mcp"
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SHOPPER_PROFILE_DIR=/data/profile \
    SHOPPER_RELAY_HOST=0.0.0.0 \
    SHOPPER_RELAY_PORT=9333
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
 && npx patchright install --with-deps chromium --no-shell \
 && rm -rf /var/lib/apt/lists/* /root/.npm
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 9333
ENTRYPOINT ["node", "dist/index.js"]

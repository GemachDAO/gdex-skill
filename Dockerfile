# Builds the GDEX MCP server (mcp-server/) from this repository's source and runs it over stdio.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build:mcp

FROM node:22-alpine
WORKDIR /app
# The server reads its version from ../package.json relative to dist/index.js.
COPY --from=build /app/mcp-server/package.json ./package.json
COPY --from=build /app/mcp-server/dist/index.js ./dist/index.js
ENTRYPOINT ["node", "/app/dist/index.js"]

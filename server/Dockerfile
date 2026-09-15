# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci -w @snip/shared -w server
COPY shared ./shared
COPY server ./server
RUN npm run build -w @snip/shared && npm run build -w server

# ---- run ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci -w @snip/shared -w server --omit=dev && npm cache clean --force
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/migrations ./shared/migrations
COPY --from=build /app/server/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]

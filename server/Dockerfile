# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server
COPY server ./server
RUN npm run build -w server

# ---- run ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/index.js"]

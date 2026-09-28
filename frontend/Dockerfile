FROM node:25-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

FROM node:25-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time —
# setting it as a runtime `environment:` on the container (as docker-compose
# does below) has no effect on already-built browser-side code, so it must
# be passed as a build arg instead.
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:5000
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL

RUN npm run build

FROM node:25-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm" , "start"]



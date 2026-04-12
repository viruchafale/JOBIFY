FROM  node:25-alpine AS builder

WORKDIR /app

COPY package.json ./

RUN npm install

COPY tsconfig.json ./

COPY src ./src

RUN npm run build

FROM  node:25-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --only=production 

COPY --from=builder /app/dist ./dist

CMD [ "node","dist/index.js" ]


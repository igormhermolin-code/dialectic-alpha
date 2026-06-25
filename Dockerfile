FROM node:24-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.js storage.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-alpine
WORKDIR /app
COPY relay/package.json .
RUN npm install --omit=dev
COPY relay/server.js .
EXPOSE 3001
CMD ["node", "server.js"]

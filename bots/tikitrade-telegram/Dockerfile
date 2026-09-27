# Para un servidor 24/7:  docker build -t tikitrade .  &&  docker run -d --restart unless-stopped --env-file .env -v "$PWD/datos:/app/datos" tikitrade
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["node", "src/index.js"]

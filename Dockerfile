FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production
EXPOSE 4180
CMD ["npm", "start"]

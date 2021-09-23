FROM node:16-buster

WORKDIR /app

RUN apt-get update && apt-get install -y chromium \
    && npm i puppeteer-core

RUN npm i moment nodemailer

COPY index.js ./

USER nobody

ENV CHROMIUM_PATH=/usr/bin/chromium

CMD node index.js

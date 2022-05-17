FROM node:16-buster

WORKDIR /app

RUN apt-get update && apt-get install -y chromium \
    && npm i puppeteer-core

RUN true && npm i moment nodemailer lodash github:gallofeliz/js-libs

COPY index.js ./

USER nobody

ENV HEADLESS=true
ENV CHROMIUM_PATH=/usr/bin/chromium

CMD exec node index.js

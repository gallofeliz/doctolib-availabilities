FROM node:16-buster AS webui

WORKDIR /build
ADD webui/package.json webui/package-lock.json ./
RUN npm i
ADD webui ./
RUN npm run build

FROM node:16-buster AS core

WORKDIR /build
RUN npm i moment nodemailer lodash github:gallofeliz/js-libs
#ADD src tsconfig.json ./
#RUN npm run build
RUN npm prune --production

FROM node:16-buster

WORKDIR /app

RUN apt-get update && apt-get install -y chromium \
    && npm i puppeteer-core

#COPY --from=core /build/dist ./
COPY --from=core /build/node_modules node_modules
COPY --from=webui /build/dist webui
RUN mkdir /data && chown node /data
VOLUME /data
COPY index.js ./
USER node
ENV HEADLESS=true
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV TZ="Europe/Paris"
CMD node .

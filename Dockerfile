FROM node:16-buster AS webui

WORKDIR /build
ADD webui/package.json webui/package-lock.json ./
RUN npm i
ADD webui ./
RUN npm run build

FROM node:16-buster AS core

WORKDIR /build
RUN npm i moment nodemailer lodash https://github.com/gallofeliz/js-libs/releases/download/v0.1.5/gallofeliz-js-libs-0.1.5.tgz
#ADD src tsconfig.json ./
#RUN npm run build
RUN npm prune --production

FROM node:16-buster

WORKDIR /app

#COPY --from=core /build/dist ./
RUN npm i puppeteer
COPY --from=core /build/node_modules node_modules
COPY --from=webui /build/dist webui
RUN mkdir /data && chown node /data
VOLUME /data
COPY index.js ./
#USER node
ENV HEADLESS=true
#ENV CHROMIUM_PATH=/usr/bin/chromium
ENV TZ="Europe/Paris"
RUN apt-get update && apt-get install  -y libnss3
CMD node .

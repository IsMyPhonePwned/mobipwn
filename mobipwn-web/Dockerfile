FROM node:20-alpine AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG MOBIPWN_RUSTY_MAGPIE_MODE=fetch
ARG RUSTY_MAGPIE_PREBUILT_URL=
ENV HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    NO_PROXY=$NO_PROXY \
    http_proxy=$HTTP_PROXY \
    https_proxy=$HTTPS_PROXY \
    no_proxy=$NO_PROXY \
    npm_config_proxy=$HTTP_PROXY \
    npm_config_https_proxy=$HTTPS_PROXY \
    npm_config_noproxy=$NO_PROXY \
    MOBIPWN_RUSTY_MAGPIE_MODE=$MOBIPWN_RUSTY_MAGPIE_MODE \
    RUSTY_MAGPIE_PREBUILT_URL=$RUSTY_MAGPIE_PREBUILT_URL
WORKDIR /app/mobipwn-web
COPY mobipwn-web/package.json mobipwn-web/package-lock.json ./
RUN npm ci
COPY mobipwn-web/ ./
COPY scripts/ensure-rusty-magpie.sh scripts/fetch-rusty-magpie.sh /app/scripts/
RUN apk add --no-cache bash curl file python3 \
    && chmod +x /app/scripts/ensure-rusty-magpie.sh /app/scripts/fetch-rusty-magpie.sh \
    && /app/scripts/ensure-rusty-magpie.sh || true
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/mobipwn-web/dist /usr/share/nginx/html
COPY mobipwn-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

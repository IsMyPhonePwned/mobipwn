# Docker image build and sharing

Build MobiPwn application images on one machine and run them on another **without compiling Rust or Node on the target**.

| Goal | Section |
|------|---------|
| Offline tarball (USB, scp) | [§1 Build and export](#1-build-and-export-build-machine) → [§2 Copy](#2-copy-to-the-target-system) → [§3 Load](#3-load-and-run-target-machine) |
| Private registry (your servers) | [§ Alternative: container registry](#alternative-container-registry) |
| **Public registry** (`docker pull` for anyone) | [§ Public registry](#public-registry-anyone-can-docker-pull) |
| **Expose on the internet** (HTTPS, firewall) | [§ Public internet deployment](#public-internet-deployment-expose-the-stack) |

Scripts:

| Script | Role |
|--------|------|
| `./scripts/build-docker-images.sh` | Build images; `--export` tarball or `--push` to registry |
| `./scripts/load-docker-images.sh` | Load tarball on target host |
| `./scripts/pull-docker-images.sh` | Pull from registry on target host |

Two Dockerfiles are used:

| Dockerfile | Images |
|------------|--------|
| `docker/Dockerfile.rust` | `mobipwn-api`, `mobipwn-jobs` (optional `mobipwn-search` with `--with-search`) |
| `mobipwn-web/Dockerfile` | `mobipwn-web` (nginx + static UI) |

Postgres and ClickHouse are **not** built locally — `docker compose` pulls upstream images on first start.

---

## Public registry — quick start

**Publish** (maintainer, once per release):

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

./scripts/build-docker-images.sh \
  --platform linux/amd64 \
  --registry ghcr.io/YOUR_GITHUB_USER/mobipwn \
  --tag 1.0.0 \
  --push
```

After first push: **GitHub → Packages → each image → Package settings → Public**.

**Deploy** (any server with Docker):

```bash
git clone https://github.com/ismyphonepwned/mobipwn.git && cd mobipwn
cp .env.example .env   # set MOBIPWN_ADMIN_PASSWORD and DB passwords
./scripts/pull-docker-images.sh --registry ghcr.io/YOUR_GITHUB_USER/mobipwn --tag 1.0.0
./compose.sh up --no-build
```

**Expose on the internet:** keep `MOBIPWN_REQUIRE_AUTH=1`, use HTTPS in front (Caddy/nginx), firewall DB ports — see [§ Public internet deployment](#public-internet-deployment-expose-the-stack).

Docker Hub: use `--registry docker.io/YOUR_DOCKERHUB_USER/mobipwn` instead of GHCR.

---

## 1. Build and export (build machine)

From the mobipwn repo root:

```bash
chmod +x scripts/build-docker-images.sh scripts/load-docker-images.sh scripts/pull-docker-images.sh

# Native platform
./scripts/build-docker-images.sh --export ./dist/mobipwn-images

# Cross-build for Linux x86 servers (e.g. from Apple Silicon Mac)
./scripts/build-docker-images.sh --platform linux/amd64 --export ./dist/mobipwn-images

# Versioned tag
./scripts/build-docker-images.sh --tag 1.0.0 --export ./dist/mobipwn-images
```

Output:

- `dist/mobipwn-images/mobipwn-images-<tag>.tar.gz` — image bundle
- `dist/mobipwn-images/README.txt` — load/run notes

Images are saved with **compose-compatible `:latest` tags** (`mobipwn-mobipwn-api:latest`, etc.) so `./compose.sh up --no-build` works after load.

### Build script options

| Option | Effect |
|--------|--------|
| `--export DIR` | Write `.tar.gz` bundle under `DIR` |
| `--platform PLAT` | e.g. `linux/amd64` for cross-build |
| `--tag TAG` | Tag images (default: `latest`, or `MOBIPWN_IMAGE_TAG` in `.env`) |
| `--registry REG` | Prefix for push, e.g. `ghcr.io/myorg/mobipwn` |
| `--push` | Push to `--registry` (requires `docker login`) |
| `--with-search` | Also build `mobipwn-search` |
| `--no-jobs` | API + web only (skip `mobipwn-jobs`) |

Corporate proxy: set `HTTP_PROXY` / `HTTPS_PROXY` in `.env` before building — see [PROXY.md](PROXY.md).

Sibling extractor repos (`../bugreport-extractor-library`, `../sysdiagnose-extractor-library`) are staged automatically when present; otherwise they are cloned during the image build.

---

## 2. Copy to the target system

Copy the **image bundle** and enough **repo config** to run the stack.

### Minimum files to copy

- `dist/mobipwn-images/` (the `.tar.gz`)
- `compose.sh`, `scripts/load-docker-images.sh`, `scripts/compose-lib.sh`, `scripts/ensure-env.sh`, `scripts/ch-migrate.sh`
- `docker-compose.stack.yml`, `clickhouse/`, `.env.example` (or your configured `.env`)

### Easiest approach

Copy or clone the **whole repo** (or ship a tarball of it) plus `dist/mobipwn-images/`.

```bash
# Example: scp
scp -r dist/mobipwn-images user@remote:/opt/mobipwn/dist/
rsync -av --exclude target --exclude node_modules ./ user@remote:/opt/mobipwn/
```

---

## 3. Load and run (target machine)

Docker or Podman with compose is required on the target.

```bash
cd /opt/mobipwn

# First time: configure env (passwords, ports, etc.)
cp .env.example .env
# edit .env

./scripts/load-docker-images.sh ./dist/mobipwn-images

# Start without rebuilding — uses loaded images
./compose.sh up --no-build
```

`--no-build` is important: it skips compile and uses the pre-built images.

On first start, compose will **pull** Postgres and ClickHouse if not already present.

| Service | Default URL |
|---------|-------------|
| Web UI | http://127.0.0.1:8080/ |
| API health | http://127.0.0.1:3000/health |
| Login | `admin` / value of `MOBIPWN_ADMIN_PASSWORD` in `.env` |

---

## Alternative: container registry

When both machines can reach a registry (Docker Hub, GHCR, private registry):

```bash
docker login ghcr.io   # or your registry

./scripts/build-docker-images.sh \
  --registry ghcr.io/YOUR_ORG/mobipwn \
  --tag 1.0.0 \
  --push
```

On the target:

```bash
./scripts/pull-docker-images.sh --registry ghcr.io/YOUR_ORG/mobipwn --tag 1.0.0
./compose.sh up --no-build
```

The pull script retags images to compose names (`mobipwn-mobipwn-api:latest`, etc.). The **tarball export** path is simpler for offline sharing.

---

## Public registry (anyone can `docker pull`)

Publish application images to a **public** registry so others can deploy without building. Postgres and ClickHouse stay on their upstream registries (compose pulls them automatically).

### GitHub Container Registry (GHCR)

1. Create a GitHub [personal access token](https://github.com/settings/tokens) with `write:packages` (and `read:packages` for private repos).
2. Make the package public after first push: **GitHub → Packages → mobipwn-api → Package settings → Change visibility**.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

./scripts/build-docker-images.sh \
  --platform linux/amd64 \
  --registry ghcr.io/YOUR_GITHUB_USER/mobipwn \
  --tag 1.0.0 \
  --push
```

Published image names:

- `ghcr.io/YOUR_GITHUB_USER/mobipwn/mobipwn-api:1.0.0`
- `ghcr.io/YOUR_GITHUB_USER/mobipwn/mobipwn-jobs:1.0.0`
- `ghcr.io/YOUR_GITHUB_USER/mobipwn/mobipwn-web:1.0.0`

Anyone can deploy:

```bash
git clone https://github.com/ismyphonepwned/mobipwn.git && cd mobipwn
cp .env.example .env   # set strong passwords — see below
./scripts/pull-docker-images.sh \
  --registry ghcr.io/YOUR_GITHUB_USER/mobipwn \
  --tag 1.0.0
./compose.sh up --no-build
```

### Docker Hub

```bash
docker login

./scripts/build-docker-images.sh \
  --registry docker.io/YOUR_DOCKERHUB_USER/mobipwn \
  --tag 1.0.0 \
  --push
```

Create the `mobipwn` repository namespace on Docker Hub first (or push will create repos per image name).

### Environment variables

| Variable | Example | Used by |
|----------|---------|---------|
| `MOBIPWN_IMAGE_REGISTRY` | `ghcr.io/myorg/mobipwn` | `pull-docker-images.sh` |
| `MOBIPWN_IMAGE_TAG` | `1.0.0` | build + pull scripts |

---

## Public internet deployment (expose the stack)

**Publishing images ≠ securing the app.** MobiPwn holds investigation data; treat a public instance like any SIEM/console.

### 1. Harden `.env` before exposing ports

```bash
MOBIPWN_REQUIRE_AUTH=1
MOBIPWN_ADMIN_USER=admin
MOBIPWN_ADMIN_PASSWORD=<long-random-password>
MOBIPWN_CLICKHOUSE_PASSWORD=<long-random-password>
# Do not set MOBIPWN_REQUIRE_AUTH=0 on the public internet
```

Create per-user **API keys** in Settings for MCP/scripts instead of sharing the admin password.

### 2. Put TLS and auth in front of the UI

Default compose binds **8080** (web) and **3000** (API) on the host. For a public URL:

- Run compose on a private network (bind to `127.0.0.1` only if you edit port mappings).
- Terminate **HTTPS** with a reverse proxy (Caddy, nginx, Traefik) and restrict access (VPN, SSO, IP allowlist, or basic auth in addition to MobiPwn login).
- Prefer exposing **only the web port** (8080); keep API on an internal network unless clients need direct API access.

Example: Caddy in front of `mobipwn-web:80` with automatic Let's Encrypt for `mobipwn.example.com`.

### 3. Firewall

Open only **443** (and **80** for ACME redirect). Block **5432**, **8123**, **9000** (Postgres/ClickHouse) from the public internet — they should stay on the Docker network.

### 4. Updates

```bash
./scripts/pull-docker-images.sh --registry ghcr.io/YOUR_USER/mobipwn --tag 1.0.1
./compose.sh up --no-build
```

---

## Quick reference

| Step | Command |
|------|---------|
| Build + export | `./scripts/build-docker-images.sh --export ./dist/mobipwn-images` |
| Push to registry | `./scripts/build-docker-images.sh --registry REG --tag TAG --push` |
| Pull from registry | `./scripts/pull-docker-images.sh --registry REG --tag TAG` |
| Load tarball | `./scripts/load-docker-images.sh ./dist/mobipwn-images` |
| Start (no compile) | `./compose.sh up --no-build` |
| Logs | `./compose.sh logs` |
| Stop | `./compose.sh down` |

Related: [PROXY.md](PROXY.md) (build-time proxy/SSL), main README **Option A — Docker/Podman full stack**.

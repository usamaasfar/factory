#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Create .env in the repository root with your integration and model credentials." >&2
  exit 1
fi

image="factory:local-test"
container="factory-test"
tunnel="factory-test-tunnel"
network="factory-test-network"
port="${FACTORY_TEST_PORT:-8080}"

# Build first so a failed build leaves the existing test container running.
docker build -t "$image" .
# Inspect the daemon-side socket so Factory can use it without running as root.
docker_group=$(docker run --rm --network none \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly \
  "$image" stat -c '%g' /var/run/docker.sock)

if ! docker network inspect "$network" >/dev/null 2>&1; then
  docker network create "$network" >/dev/null
fi

created_tunnel=false
if [[ "$(docker inspect -f '{{.State.Running}}' "$tunnel" 2>/dev/null || true)" == "true" ]]; then
  echo "Keeping the existing Cloudflare tunnel running."
else
  docker pull cloudflare/cloudflared:latest
  if docker container inspect "$tunnel" >/dev/null 2>&1; then
    docker rm -f "$tunnel" >/dev/null
  fi
  echo "Starting a temporary public Cloudflare tunnel..."
  docker run -d --name "$tunnel" --restart unless-stopped --network "$network" \
    cloudflare/cloudflared:latest tunnel --no-autoupdate --url "http://$container:8080"
  created_tunnel=true
fi

# Ignore URLs from earlier runs if Docker restarted the tunnel container.
tunnel_started_at=$(docker inspect -f '{{.State.StartedAt}}' "$tunnel")
public_url=""
for ((attempt = 0; attempt < 60; attempt++)); do
  public_url=$(docker logs --since "$tunnel_started_at" "$tunnel" 2>&1 | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1 || true)
  if [[ -n "$public_url" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "$public_url" ]]; then
  echo "Cloudflare did not supply a tunnel URL. Logs:" >&2
  docker logs --tail 50 "$tunnel" >&2
  if [[ "$created_tunnel" == "true" ]]; then
    docker rm -f "$tunnel" >/dev/null
  fi
  exit 1
fi

if docker container inspect "$container" >/dev/null 2>&1; then
  docker rm -f "$container" >/dev/null
fi

docker run -d --name "$container" --init --restart unless-stopped --network "$network" \
  --env-file .env \
  --group-add "$docker_group" \
  -e FACTORY_DOCKER_SOCKET=/var/run/docker.sock \
  -e PUBLIC_BASE_URL="$public_url" \
  -e NODE_ENV=development \
  -e HOST=0.0.0.0 \
  -e PORT=8080 \
  -e WORKFLOWS_DIR=/app/.factory/workflows \
  --mount "type=bind,src=$PWD/.factory,dst=/app/.factory,readonly" \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly \
  -p "127.0.0.1:$port:8080" \
  "$image"

for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$container" bun -e \
    'const response = await fetch("http://127.0.0.1:8080/health"); if (!response.ok || (await response.json()).status !== "ok") process.exit(1);' \
    >/dev/null 2>&1; then
    echo "Factory is running at http://127.0.0.1:$port (.factory/workflows, .env)."
    echo "Public URL: $public_url"
    echo "Slack webhook: $public_url/webhook/slack"
    echo "Rebuilds keep this URL while the tunnel stays running; a tunnel restart changes it."
    echo "Streaming Factory logs. Ctrl+C leaves Factory and the tunnel running."
    exec docker logs --follow "$container"
  fi
  sleep 1
done

echo "Factory did not become healthy. Startup logs:" >&2
docker logs --tail 50 "$container" >&2
exit 1

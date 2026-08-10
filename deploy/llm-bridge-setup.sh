#!/usr/bin/env bash
# Идемпотентная установка моста к подписке Claude (tools/llm-bridge/server.mjs).
# Запуск: sudo bash deploy/llm-bridge-setup.sh
set -euo pipefail

REPO="${REPO:-/opt/steam-psycho}"
ENV_FILE="/etc/gamertype-llm-bridge.env"
PROJ_ENV="$REPO/.env.local"
PORT="${BRIDGE_PORT:-8788}"
CONTAINER="${CONTAINER:-steam-psycho-app-1}"

# Шлюз берём из сети САМОГО контейнера. У steam-psycho она своя (172.19.0.1);
# docker0 (172.17.0.1), на который смотрит аналогичный скрипт в projectlevin,
# здесь не подходит — контейнер моста на нём не увидит.
NET="$(docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)"
HOST_IP=""
if [ -n "$NET" ]; then
  HOST_IP="$(docker network inspect "$NET" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
fi
if [ -z "$HOST_IP" ]; then
  echo "Не удалось определить шлюз сети контейнера $CONTAINER." >&2
  echo "Запусти контейнер или задай BRIDGE_HOST вручную." >&2
  exit 1
fi

# Секрет переиспользуем, чтобы перезапуск установки не разлогинил приложение.
if [ -f "$ENV_FILE" ] && grep -q '^BRIDGE_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(grep '^BRIDGE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
else
  TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
fi

# Свой домашний каталог для дочернего claude: иначе он подхватит плагины,
# навыки и хук старта сессии владельца из /root/.claude (см. Task 6, шаг 0
# в tools/llm-bridge/server.mjs). Авторизацию КОПИРУЕМ, а не связываем
# ссылкой — поэтому после `claude /login` у владельца её надо скопировать
# заново, повторный запуск этого скрипта делает это сам. Если мост однажды
# начнёт отвечать status=stale, а `claude` у владельца работает нормально,
# первым делом проверь именно это.
BRIDGE_HOME="${BRIDGE_HOME:-/var/lib/gamertype-bridge}"
install -d -m 700 "$BRIDGE_HOME/.claude"
install -m 600 /root/.claude/.credentials.json "$BRIDGE_HOME/.claude/.credentials.json"

umask 077
cat > "$ENV_FILE" <<EOF
BRIDGE_HOST=$HOST_IP
BRIDGE_PORT=$PORT
BRIDGE_TOKEN=$TOKEN
BRIDGE_MAX_CONCURRENT=${BRIDGE_MAX_CONCURRENT:-2}
BRIDGE_QUEUE_MAX=${BRIDGE_QUEUE_MAX:-4}
BRIDGE_TIMEOUT_MS=${BRIDGE_TIMEOUT_MS:-180000}
BRIDGE_HEALTH_TTL_MS=${BRIDGE_HEALTH_TTL_MS:-60000}
BRIDGE_MODEL=${BRIDGE_MODEL:-claude-sonnet-5}
BRIDGE_HOME=$BRIDGE_HOME
EOF
echo "✓ $ENV_FILE (шлюз $HOST_IP, порт $PORT)"

# Настройки приложения. LLM_PROVIDER скрипт НЕ трогает — переключение
# на мост делается отдельно и осознанно.
touch "$PROJ_ENV"
sed -i '/^CLAUDE_BRIDGE_ENDPOINT=/d;/^CLAUDE_BRIDGE_TOKEN=/d' "$PROJ_ENV"
{
  echo "CLAUDE_BRIDGE_ENDPOINT=http://host.docker.internal:$PORT/generate"
  echo "CLAUDE_BRIDGE_TOKEN=$TOKEN"
} >> "$PROJ_ENV"
echo "✓ $PROJ_ENV"

install -m 644 "$REPO/deploy/llm-bridge.service" /etc/systemd/system/gamertype-llm-bridge.service
systemctl daemon-reload
systemctl enable --now gamertype-llm-bridge.service
systemctl restart gamertype-llm-bridge.service
sleep 1

echo "--- статус ---"
systemctl --no-pager --lines=5 status gamertype-llm-bridge.service || true
echo
echo "Дальше:"
echo "  1) проверить живость:  curl -sS http://$HOST_IP:$PORT/health"
echo "     status=stale означает, что нужен вход: claude login"
echo "  2) включить мост:      LLM_PROVIDER=claude-bridge в $PROJ_ENV"
echo "  3) применить:          docker compose up -d --build app"

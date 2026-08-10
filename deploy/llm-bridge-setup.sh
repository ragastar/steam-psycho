#!/usr/bin/env bash
# Идемпотентная установка моста к подписке Claude (tools/llm-bridge/server.mjs).
# Запуск: sudo bash deploy/llm-bridge-setup.sh
set -euo pipefail

REPO="${REPO:-/opt/steam-psycho}"
ENV_FILE="/etc/gamertype-llm-bridge.env"
PROJ_ENV="$REPO/.env.local"
PORT="${BRIDGE_PORT:-8788}"
CONTAINER="${CONTAINER:-steam-psycho-app-1}"
SERVICE="gamertype-llm-bridge.service"
# Пустой каталог, в котором работает дочерний claude (см. WorkingDirectory
# в юните). Ничего ценного тут лежать не должно — это его смысл.
WORKDIR="/var/lib/gamertype-llm-bridge"

# Шлюз берём из сети САМОГО контейнера. У steam-psycho она своя (172.19.0.1);
# docker0 (172.17.0.1), на который смотрит аналогичный скрипт в projectlevin,
# здесь не подходит — контейнер моста на нём не увидит.
#
# BRIDGE_HOST, заданный руками, уважаем: сообщение об ошибке ниже именно это
# и предлагает, а раньше скрипт его игнорировал и всё равно лез в docker.
HOST_IP="${BRIDGE_HOST:-}"
if [ -z "$HOST_IP" ]; then
  NET="$(docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)"
  if [ -n "$NET" ]; then
    # Берём ПЕРВУЮ запись IPAM.Config, а не все подряд. Прежний шаблон
    # {{range .IPAM.Config}}{{.Gateway}}{{end}} склеивал записи без
    # разделителя: при включённом IPv6 получалось "172.19.0.1fd00::1" —
    # адрес, которого не существует. server.listen падал бы с EADDRNOTAVAIL.
    HOST_IP="$(docker network inspect "$NET" \
      --format '{{range $i, $c := .IPAM.Config}}{{if eq $i 0}}{{$c.Gateway}}{{end}}{{end}}' 2>/dev/null || true)"
  fi
fi
if [ -z "$HOST_IP" ]; then
  echo "Не удалось определить шлюз сети контейнера $CONTAINER." >&2
  echo "Запусти контейнер или задай BRIDGE_HOST вручную." >&2
  exit 1
fi
# Адрес проверяем ДО того, как записать его в конфиг и перезапустить службу:
# кривое значение иначе всплывает только падением server.listen внутри юнита,
# то есть там, где его никто не видит.
if ! [[ "$HOST_IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
  echo "Шлюз определился как '$HOST_IP' — это не похоже на IPv4-адрес." >&2
  echo "Скорее всего у сети несколько записей IPAM (например, IPv6)." >&2
  echo "Задай адрес вручную: BRIDGE_HOST=172.19.0.1 sudo bash $0" >&2
  exit 1
fi
# Мост слушает шлюз docker-сети, но никогда 0.0.0.0: иначе он торчал бы
# в интернет, а за ним — подписка Claude Max.
if [ "$HOST_IP" = "0.0.0.0" ] || [ "$HOST_IP" = "::" ]; then
  echo "BRIDGE_HOST=$HOST_IP недопустим: мост нельзя открывать наружу." >&2
  exit 1
fi

# Секрет переиспользуем, чтобы перезапуск установки не разлогинил приложение.
if [ -f "$ENV_FILE" ] && grep -q '^BRIDGE_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(grep '^BRIDGE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
else
  TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
fi

# Авторизация подписки НИКУДА не копируется: мост читает /root/.claude
# владельца напрямую. Копия во втором каталоге протухала бы после каждого
# входа, мост молча отвечал бы «сессия мертва», а сайт так же молча уходил
# бы на платный ключ — выглядит как необъяснимая поломка. Решение владельца
# от 2026-08-10, обоснование в спеке моста.

umask 077
# Бюджеты ожидания ВЛОЖЕНЫ друг в друга, а не равны:
#   nginx proxy_read_timeout         180000  (снаружи, не в этом репозитории)
#   > CLAUDE_BRIDGE_TOTAL_TIMEOUT_MS 115000  (обе попытки моста вместе)
#   > CLAUDE_BRIDGE_TIMEOUT_MS       110000  (одна попытка, у клиента)
#   > BRIDGE_TIMEOUT_MS              100000  (дочерний claude, здесь)
# Смысл: когда сессия протухла и claude молчит, мост обязан вернуть 502
# РАНЬШЕ, чем клиент оборвёт запрос, а клиент — раньше, чем nginx отдаст 504.
# Иначе запасной платный ключ не успевает сработать ни разу.
# 100000 — измеренное значение: боевая карточка заняла 77 секунд.
cat > "$ENV_FILE" <<EOF
BRIDGE_HOST=$HOST_IP
BRIDGE_PORT=$PORT
BRIDGE_TOKEN=$TOKEN
BRIDGE_MAX_CONCURRENT=${BRIDGE_MAX_CONCURRENT:-2}
BRIDGE_QUEUE_MAX=${BRIDGE_QUEUE_MAX:-4}
BRIDGE_TIMEOUT_MS=${BRIDGE_TIMEOUT_MS:-100000}
BRIDGE_HEALTH_TTL_MS=${BRIDGE_HEALTH_TTL_MS:-60000}
BRIDGE_HEALTH_TIMEOUT_MS=${BRIDGE_HEALTH_TIMEOUT_MS:-30000}
BRIDGE_MODEL=${BRIDGE_MODEL:-claude-sonnet-5}
EOF
echo "✓ $ENV_FILE (шлюз $HOST_IP, порт $PORT)"

# Пустой рабочий каталог для дочернего claude.
install -d -m 700 "$WORKDIR"
echo "✓ $WORKDIR"

# Настройки приложения. LLM_PROVIDER скрипт НЕ трогает — переключение
# на мост делается отдельно и осознанно.
touch "$PROJ_ENV"
sed -i '/^CLAUDE_BRIDGE_ENDPOINT=/d;/^CLAUDE_BRIDGE_TOKEN=/d;/^CLAUDE_BRIDGE_TIMEOUT_MS=/d;/^CLAUDE_BRIDGE_TOTAL_TIMEOUT_MS=/d' "$PROJ_ENV"
# Дозапись без перевода строки в конце файла приклеила бы первую нашу строку
# к чужой последней: получилось бы "RATE_LIMIT_PER_HOUR=30CLAUDE_BRIDGE_..."
# — обе переменные молча пропали бы, а мост «просто не включился».
if [ -s "$PROJ_ENV" ] && [ -n "$(tail -c 1 "$PROJ_ENV")" ]; then
  printf '\n' >> "$PROJ_ENV"
fi
# Адрес моста для контейнера — ШЛЮЗ ЕГО СОБСТВЕННОЙ СЕТИ, а не
# host.docker.internal. Проверено на живом сервере 2026-08-10:
# extra_hosts "host.docker.internal:host-gateway" резолвится в docker0
# (172.17.0.1), а мост слушает шлюз сети steam-psycho_default (172.19.0.1).
# Через host.docker.internal контейнер получал "Connection refused", сайт
# молча уходил на платный ключ ПРИ ЖИВОМ МОСТЕ — то есть подписка не
# использовалась бы вообще, и заметить это было бы нечем.
{
  echo "CLAUDE_BRIDGE_ENDPOINT=http://$HOST_IP:$PORT/generate"
  echo "CLAUDE_BRIDGE_TOKEN=$TOKEN"
  echo "CLAUDE_BRIDGE_TIMEOUT_MS=${CLAUDE_BRIDGE_TIMEOUT_MS:-110000}"
  echo "CLAUDE_BRIDGE_TOTAL_TIMEOUT_MS=${CLAUDE_BRIDGE_TOTAL_TIMEOUT_MS:-115000}"
} >> "$PROJ_ENV"
echo "✓ $PROJ_ENV"

install -m 644 "$REPO/deploy/llm-bridge.service" "/etc/systemd/system/$SERVICE"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"

# Проверяем, что служба ДЕЙСТВИТЕЛЬНО поднялась. Раньше здесь было
# `sleep 1; systemctl status || true`, и скрипт выходил с кодом 0 с зелёной
# галочкой даже когда юнит уже свалился в failed (например, EADDRNOTAVAIL
# из-за неверно определённого шлюза). Владелец видел успех и мёртвый мост.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  systemctl is-active --quiet "$SERVICE" && break
  sleep 1
done
if ! systemctl is-active --quiet "$SERVICE"; then
  echo >&2
  echo "✗ Служба $SERVICE не поднялась. Последние записи журнала:" >&2
  systemctl --no-pager --lines=20 status "$SERVICE" >&2 || true
  journalctl -u "$SERVICE" --no-pager --lines=30 >&2 || true
  exit 1
fi

echo "--- статус ---"
systemctl --no-pager --lines=5 status "$SERVICE"
echo
echo "Дальше:"
echo "  1) проверить живость:  curl -sS -H 'x-bridge-token: $TOKEN' http://$HOST_IP:$PORT/health"
echo "     status=stale означает, что нужен вход: claude login"
echo "     (без заголовка с секретом /health отвечает 401 — так и задумано)"
echo "  2) включить мост:      LLM_PROVIDER=claude-bridge в $PROJ_ENV"
echo "  3) применить:          docker compose up -d --build app"

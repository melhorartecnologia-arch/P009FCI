#!/usr/bin/env bash
# ============================================================================
# Instalação do Simulador FCI em VPS AWS Ubuntu (22.04/24.04)
# Aplicação 100% Node.js/JavaScript + PostgreSQL na MESMA instância.
#
# Uso (como root ou sudo, a partir da pasta do repositório clonado):
#   sudo bash scripts/install-vps.sh
#
# O script é idempotente: pode ser reexecutado para atualizar a aplicação.
# ============================================================================
set -euo pipefail

APP_DIR=/opt/simulador-fci
DB_NAME=fci_simulador
DB_USER=fci_app
SERVICO=fci-simulador
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Simulador FCI · instalação na VPS =="

# ----------------------------------------------------------------------------
# 1. Dependências do sistema: Node.js 20 LTS + PostgreSQL (mesma instância)
# ----------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
if ! command -v psql >/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
systemctl enable --now postgresql

# ----------------------------------------------------------------------------
# 2. Usuário de serviço e diretório da aplicação
# ----------------------------------------------------------------------------
id -u fci >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin fci
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude dados \
  "$REPO_DIR"/ "$APP_DIR"/
mkdir -p "$APP_DIR/dados"

# ----------------------------------------------------------------------------
# 3. Banco PostgreSQL local (cria papel + base; alinha a senha ao .env novo)
# ----------------------------------------------------------------------------
ROLE_EXISTE="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" || true)"
DB_PASS="$(openssl rand -hex 24)"
if [ "$ROLE_EXISTE" != "1" ]; then
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
  echo "Papel $DB_USER criado."
elif [ ! -f "$APP_DIR/.env" ]; then
  # papel existe mas o .env será gerado agora — sincroniza a senha
  sudo -u postgres psql -c "ALTER ROLE $DB_USER PASSWORD '$DB_PASS';"
  echo "Papel $DB_USER existente; senha redefinida para o novo .env."
else
  echo "Papel $DB_USER e .env existentes (senha preservada)."
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

# ----------------------------------------------------------------------------
# 4. Arquivo .env (gera segredos apenas na primeira instalação)
# ----------------------------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
PORT=3000
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=$DB_NAME
PGUSER=$DB_USER
PGPASSWORD=$DB_PASS
FCI_SECRET_KEY=$(openssl rand -hex 32)
FCI_JWT_SECRET=$(openssl rand -hex 32)
FCI_JWT_EXPIRA=12h
FCI_SYNC_AGENDADA=true
SEED_SENHA=cci@2026
EOF
  chmod 600 "$APP_DIR/.env"
  echo ".env criado com segredos gerados (FCI_SECRET_KEY/FCI_JWT_SECRET)."
else
  echo ".env existente preservado."
fi
chown -R fci:fci "$APP_DIR"

# ----------------------------------------------------------------------------
# 5. Dependências Node, migração do schema e seed inicial
# ----------------------------------------------------------------------------
cd "$APP_DIR"
sudo -u fci npm install --omit=dev --no-audit --no-fund
sudo -u fci npm run migrate
sudo -u fci npm run seed

# ----------------------------------------------------------------------------
# 6. Serviço systemd
# ----------------------------------------------------------------------------
cp "$APP_DIR/scripts/fci-simulador.service" "/etc/systemd/system/$SERVICO.service"
systemctl daemon-reload
systemctl enable --now "$SERVICO"
sleep 2
systemctl --no-pager status "$SERVICO" | head -6

echo
echo "== Instalação concluída =="
echo "Aplicação:  http://<ip-da-vps>:3000  (libere a porta no Security Group ou use Nginx como proxy)"
echo "Login TI:   ti@cci.local · senha inicial definida em SEED_SENHA (padrão cci@2026) — troque no 1º acesso"
echo "Serviço:    systemctl status $SERVICO · journalctl -u $SERVICO -f"

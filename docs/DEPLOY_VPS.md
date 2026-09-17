# Deploy — VPS AWS Ubuntu (aplicação + PostgreSQL na mesma instância)

Arquitetura de produção definida para o projeto: **uma instância EC2 Ubuntu**
executando o Node.js (systemd) e o **PostgreSQL local** (`127.0.0.1`), sem
serviços externos. As integrações saem dessa instância para as origens
corporativas (Protheus/Oracle, Portal de Custos/SQL Server, APIs).

## 1. Pré-requisitos na AWS

- Instância EC2 Ubuntu 22.04/24.04 (t3.small ou superior recomendado).
- Security Group: libere `22/tcp` (SSH) e a porta pública escolhida —
  `3000/tcp` para acesso direto **ou** `80/443` se usar Nginx (recomendado).
- A instância precisa alcançar as origens corporativas (VPN/peering conforme a
  rede da CCI) para as integrações reais.

## 2. Instalação automatizada

```bash
sudo apt-get update && sudo apt-get install -y git
git clone <este-repositório> /tmp/p009fci && cd /tmp/p009fci
sudo bash scripts/install-vps.sh
```

O script (idempotente — reexecute para atualizar):

1. instala Node.js 20 LTS e PostgreSQL (mesma instância);
2. cria o usuário de serviço `fci` e copia a aplicação para `/opt/simulador-fci`;
3. cria papel `fci_app` (senha aleatória) e base `fci_simulador`;
4. gera `/opt/simulador-fci/.env` com `FCI_SECRET_KEY`/`FCI_JWT_SECRET`
   aleatórios (arquivo `600`, preservado em reinstalações);
5. roda `npm run migrate` (schema `fci` + demo `erp_demo`) e `npm run seed`
   (usuários, parâmetros, fontes e primeira sincronização);
6. instala e ativa o serviço systemd **fci-simulador**.

Verificação:

```bash
systemctl status fci-simulador
journalctl -u fci-simulador -f
curl -s http://127.0.0.1:3000/api/saude
```

## 3. Instalação manual (equivalente)

```bash
# Node 20 + PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs postgresql

# Banco local
sudo -u postgres psql -c "CREATE ROLE fci_app LOGIN PASSWORD 'senha-forte';"
sudo -u postgres createdb -O fci_app fci_simulador

# Aplicação
sudo mkdir -p /opt/simulador-fci && sudo chown $USER /opt/simulador-fci
git clone <repo> /opt/simulador-fci && cd /opt/simulador-fci
cp .env.example .env   # preencha PG*, FCI_SECRET_KEY e FCI_JWT_SECRET (openssl rand -hex 32)
npm install --omit=dev
npm run setup
sudo cp scripts/fci-simulador.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now fci-simulador
```

## 4. Nginx + HTTPS (recomendado para produção)

```bash
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/fci <<'EOF'
server {
  listen 80;
  server_name fci.cci.local;            # ajuste para o DNS interno/externo
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
EOF
sudo ln -sf /etc/nginx/sites-available/fci /etc/nginx/sites-enabled/fci
sudo nginx -t && sudo systemctl reload nginx
# HTTPS com certificado próprio ou certbot, conforme política da CCI.
```

Com Nginx na frente, restrinja a porta 3000 ao localhost (não a exponha no
Security Group).

## 5. Conectar as origens reais (pós-gate G1)

No perfil **TI** → tela **Integrações**:

1. **ERP Protheus (Oracle):** editar conexão → conector `oracle`, host/porta/
   service name do banco do Protheus, usuário somente-leitura `fci_ro` e
   credencial; ajustar o mapeamento para as tabelas reais (`SB1010`,
   `SG1010`, `SD1010`… conforme o ambiente) mantendo os campos B1_COD,
   B1_DESC, B1_ORIGEM, D1_CLASFIS.
2. **Portal de Custos (SQL Server):** conector `mssql`, base `PortalCustos`,
   view `vw_CustoEntrada`.
3. **Sistema de Preços:** conector `postgres`/`mssql`/`rest` conforme o
   ambiente do Pricing.
4. **Câmbio:** conector `rest` para o BACEN PTAX (`olinda.bcb.gov.br`,
   recurso OData `CotacaoMoedaDia`) ou mantenha a tabela do Financeiro.
5. Em cada fonte: **Testar conexão** (RF-092) → **Sincronizar agora**
   (RF-093) → conferir status e “última sync” (RF-094).

Os drivers Oracle/SQL Server/MySQL são dependências opcionais já declaradas;
se a instalação os omitiu, `npm install oracledb mssql mysql2` na pasta da
aplicação e reinicie o serviço. O conector Oracle usa o modo *thin*
(100% JavaScript) — não requer Oracle Instant Client.

## 6. Operação

| Ação | Comando |
| --- | --- |
| Logs em tempo real | `journalctl -u fci-simulador -f` |
| Reiniciar | `sudo systemctl restart fci-simulador` |
| Atualizar versão | `cd repositório && git pull && sudo bash scripts/install-vps.sh` |
| Backup do banco | `pg_dump -U fci_app -h 127.0.0.1 fci_simulador > backup.sql` |
| Testes de aceite | `cd /opt/simulador-fci && npm install --include=dev && npm test` |

**Segurança:** o `.env` guarda a chave que cifra as credenciais das
integrações (RNF-05) — mantenha `600` e fora de versionamento; troque a senha
inicial dos usuários seed no primeiro acesso; crie usuários nominais pela tela
Usuários (perfil TI).

# Deploy — AWS Lightsail Ubuntu (banco + aplicação na mesma VPS, sem compilação)

Guia passo a passo para colocar o **Simulador FCI** no ar em uma instância
**AWS Lightsail** com Ubuntu, com o **PostgreSQL e a aplicação Node.js na
mesma VPS**. Não há nenhuma etapa de compilação: o Node.js é instalado por
pacote binário, o frontend é JavaScript puro (sem build) e todas as
dependências npm são JavaScript puro ou trazem binários pré-compilados
(o driver Oracle `oracledb` já vem pronto para x86_64 e ARM64 — o
`npm install` apenas baixa arquivos).

Tempo estimado: **20–30 minutos**.

---

## Parte A · Criar a instância no Lightsail

1. Acesse o console: <https://lightsail.aws.amazon.com> → **Create instance**.
2. **Região**: escolha a mais próxima (ex.: São Paulo `sa-east-1`).
3. **Platform**: *Linux/Unix* → **Blueprint**: *Operating System (OS) Only* →
   **Ubuntu 24.04 LTS** (ou 22.04 LTS).
4. **Plano**: recomendado **2 GB RAM / 2 vCPU** (aplicação + PostgreSQL na
   mesma máquina). O plano de 1 GB funciona, mas crie o swap da Parte B-4.
   Tanto instâncias x86_64 quanto ARM (Graviton) são suportadas.
5. Nomeie a instância (ex.: `fci-simulador`) e clique **Create instance**.

### A-2 · IP estático (obrigatório)

6. Menu **Networking** → **Create static IP** → anexe à instância
   `fci-simulador`. Sem isso, o IP público muda a cada reinicialização.
   Anote o IP (será chamado de `IP_DA_VPS` neste guia).

### A-3 · Firewall da instância

7. Abra a instância → aba **Networking** → seção **IPv4 Firewall**.
   Deixe apenas:
   | Aplicação | Protocolo | Porta | Observação |
   | --- | --- | --- | --- |
   | SSH | TCP | 22 | já vem criado (restrinja ao seu IP, se possível) |
   | HTTP | TCP | 80 | **adicionar** — acesso à aplicação via Nginx |
   | HTTPS | TCP | 443 | adicionar apenas se for configurar TLS (Parte F) |

   **Não abra** as portas 3000 (Node) nem 5432 (PostgreSQL) — ambas ficam
   restritas ao `127.0.0.1` dentro da VPS.

### A-4 · Acessar por SSH

8. Opção rápida: botão **Connect using SSH** (terminal no navegador).
   Opção terminal local: em **Account → SSH keys**, baixe a *default key*
   (`.pem`) e conecte:
   ```bash
   chmod 400 LightsailDefaultKey-sa-east-1.pem
   ssh -i LightsailDefaultKey-sa-east-1.pem ubuntu@IP_DA_VPS
   ```

---

## Parte B · Preparar o sistema (tudo por pacote binário)

Execute na VPS, como usuário `ubuntu`:

```bash
# 1. Atualizar o sistema
sudo apt-get update && sudo apt-get -y upgrade

# 2. Node.js 20 LTS via NodeSource (pacote .deb pronto — nada é compilado)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # deve mostrar v20.x

# 3. PostgreSQL (mesma VPS; escuta somente 127.0.0.1 por padrão — manter assim)
sudo apt-get install -y postgresql postgresql-contrib git
sudo systemctl enable --now postgresql
```

```bash
# 4. (APENAS no plano de 1 GB RAM) criar swap de 2 GB para dar folga ao PostgreSQL
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Parte C · Obter o código

O repositório é privado; escolha uma das opções:

**Opção 1 — token do GitHub (recomendada):** no GitHub, crie um
*fine-grained personal access token* com acesso somente-leitura ao
repositório `melhorartecnologia-arch/P009FCI` (Settings → Developer settings
→ Personal access tokens → Fine-grained → Repository access: só este repo →
Permissions → Contents: **Read-only**). Depois, na VPS:

```bash
git clone -b claude/affectionate-hawking-u71hh8 \
  https://SEU_TOKEN@github.com/melhorartecnologia-arch/P009FCI.git /tmp/p009fci
```

> Se a branch já tiver sido integrada à principal, troque
> `-b claude/affectionate-hawking-u71hh8` pela branch principal.

**Opção 2 — upload manual:** baixe o ZIP da branch no GitHub
(**Code → Download ZIP**) e envie para a VPS:

```bash
scp -i LightsailDefaultKey.pem P009FCI.zip ubuntu@IP_DA_VPS:/tmp/
# na VPS:
sudo apt-get install -y unzip && cd /tmp && unzip P009FCI.zip && mv P009FCI-* p009fci
```

---

## Parte D · Instalar tudo com um comando

```bash
cd /tmp/p009fci
sudo bash scripts/install-vps.sh
```

O script é **idempotente** (pode reexecutar para atualizar) e faz, nesta ordem:

1. instala utilitários básicos + PostgreSQL + Node.js 20 caso faltem;
2. cria o usuário de serviço `fci` e copia a aplicação para `/opt/simulador-fci`;
3. cria o papel `fci_app` (senha aleatória) e o banco `fci_simulador` no
   PostgreSQL **local**;
4. gera `/opt/simulador-fci/.env` (permissão 600) com `FCI_SECRET_KEY` e
   `FCI_JWT_SECRET` aleatórios — preservado nas próximas execuções;
5. roda `npm install --omit=dev` (**somente download** — nenhuma dependência
   compila: `bcryptjs`, `pg`, `mssql`, `mysql2` são JS puro e o `oracledb`
   usa binário pré-compilado incluso no pacote);
6. aplica as migrações (`sql/001_schema.sql` + base de demonstração
   `erp_demo`) e o seed (usuários, parâmetros, 5 fontes de dados e primeira
   sincronização);
7. instala e inicia o serviço **systemd** `fci-simulador` (reinício
   automático em falha e no boot).

**Verificação imediata:**

```bash
systemctl status fci-simulador          # deve estar "active (running)"
curl -s http://127.0.0.1:3000/api/saude # {"ok":true,"aplicacao":"Simulador FCI",...}
```

---

## Parte E · Expor na porta 80 com Nginx

O firewall do Lightsail (Parte A-3) só expõe a porta 80; o Nginx repassa
para o Node na 3000:

```bash
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/fci >/dev/null <<'EOF'
server {
  listen 80 default_server;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/fci /etc/nginx/sites-enabled/fci
sudo nginx -t && sudo systemctl reload nginx
```

Acesse **`http://IP_DA_VPS`** no navegador → tela de login do Simulador FCI.

> Alternativa sem Nginx (ambiente de teste): abra a porta 3000 no firewall
> do Lightsail e acesse `http://IP_DA_VPS:3000`. Não recomendado para uso
> contínuo.

---

## Parte F · (Opcional) Domínio + HTTPS

1. No Lightsail (**Networking → DNS zone**) ou no seu DNS, crie um registro
   `A` (ex.: `fci.suaempresa.com.br`) apontando para o IP estático.
2. Ajuste `server_name fci.suaempresa.com.br;` no Nginx e recarregue.
3. Certificado gratuito Let's Encrypt (também sem compilação):
   ```bash
   sudo snap install --classic certbot
   sudo certbot --nginx -d fci.suaempresa.com.br
   ```
4. Abra a porta 443 no firewall do Lightsail (Parte A-3).

---

## Parte G · Primeiro acesso e pós-instalação

1. Acesse `http://IP_DA_VPS` → login **`ti@cci.local`** · senha inicial
   **`cci@2026`** (valor de `SEED_SENHA` no `.env`).
2. **Troque as senhas** dos usuários seed na tela **Usuários** (perfil TI) e
   crie os usuários nominais das áreas.
3. Tela **Integrações**: as 5 fontes vêm conectadas ao schema de
   demonstração `erp_demo` (mesma VPS). Para ligar nas origens reais, o
   administrador apenas **edita a conexão** (ex.: conector `oracle` com o
   host do Protheus, `mssql` para o Portal de Custos) e ajusta o
   **Mapeamento** — sem mexer em código. Use **Testar conexão** e
   **Sincronizar agora** para validar. A VPS precisa alcançar essas origens
   (VPN/peering da rede da CCI, quando aplicável).
4. Crie um cenário de teste e confirme a estrutura carregada (marco M1).

---

## Parte H · Operação do dia a dia

| Ação | Comando |
| --- | --- |
| Logs em tempo real | `sudo journalctl -u fci-simulador -f` |
| Reiniciar aplicação | `sudo systemctl restart fci-simulador` |
| Status app / banco | `systemctl status fci-simulador postgresql` |
| **Atualizar versão** | `cd /tmp/p009fci && git pull && sudo bash scripts/install-vps.sh` |
| Backup do banco | `sudo -u postgres pg_dump fci_simulador > fci_$(date +%F).sql` |
| Backup completo | Lightsail → instância → **Snapshots** (manual ou automático diário) |
| Testes de aceite na VPS | `cd /opt/simulador-fci && sudo -u fci npm install --include=dev && sudo -u fci npm test` |

**Segurança:** o `.env` (em `/opt/simulador-fci/.env`, permissão 600) guarda
a chave que cifra as credenciais das integrações — não copie nem versione;
o PostgreSQL e o Node só escutam em `127.0.0.1`; a única porta pública é a
80/443 do Nginx; mantenha o SSH restrito ao seu IP no firewall do Lightsail.

## Solução de problemas

| Sintoma | Causa provável / correção |
| --- | --- |
| `systemctl status` mostra falha e o log cita variáveis ausentes | `.env` sem `FCI_SECRET_KEY`/`FCI_JWT_SECRET` — reexecute o script ou edite `/opt/simulador-fci/.env` |
| Página não abre no navegador | Porta 80 não liberada no firewall do **Lightsail** (é lá, não no Ubuntu) ou Nginx parado (`sudo systemctl status nginx`) |
| `Sincronizar agora` falha nas fontes demo | PostgreSQL parado (`sudo systemctl start postgresql`) — o card mostra o erro e a última carga válida permanece (RF-095) |
| Lentidão / travamentos no plano de 1 GB | Crie o swap (Parte B-4) ou suba para o plano de 2 GB |
| IP mudou após reiniciar | Static IP não estava anexado (Parte A-2) |

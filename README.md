# Simulador FCI · Cervejaria Cidade Imperial

Aplicação web para criação, alteração e comparação de **cenários de conteúdo de
importação (CI%)** dos produtos — apoio às decisões de Compras, Custos, Pricing,
Fiscal e Controladoria. Ambiente **analítico e sem validade fiscal**: não gera,
não assina e não transmite a FCI oficial, e não altera cadastros do Protheus
(RN-12 · D-01).

> **Entrega atual: Semana 1 do cronograma (14/09 → 18/09) — Fundação de dados,
> parâmetros e cenário.** Requisitos com entrega até 17/09 implementados e
> testados; RF-002 e RF-100 (18/09) incluídos. Detalhe em
> [`docs/ESCOPO_S1.md`](docs/ESCOPO_S1.md).

## Stack

- **100% Node.js + JavaScript** (backend Express, frontend SPA em JS puro sem build)
- **PostgreSQL na mesma instância** (VPS AWS Ubuntu) — schema `fci` da aplicação
  e schema `erp_demo` de demonstração das origens
- Conectores de integração **abstratos e configuráveis pelo administrador**:
  `postgres` · `oracle` (Protheus, modo thin 100% JS) · `mssql` (Portal de
  Custos) · `mysql` · `rest` (APIs/BACEN PTAX) · `arquivo` (JSON/CSV para carga
  complementar)
- Interface fiel ao protótipo aprovado no discovery (handoff Claude Design em
  [`docs/prototipo/`](docs/prototipo/))

## Como executar (desenvolvimento)

```bash
# 1. PostgreSQL local com a base criada
createdb fci_simulador

# 2. Configuração
cp .env.example .env        # preencha PG* e gere FCI_SECRET_KEY / FCI_JWT_SECRET
                            # (openssl rand -hex 32)

# 3. Dependências, schema e dados de demonstração
npm install
npm run setup               # migrate + seed (usuários, parâmetros, fontes, 1ª sincronização)

# 4. Subir
npm start                   # http://127.0.0.1:3000
npm test                    # testes de fumaça dos critérios de aceite da S1
```

### Usuários criados pelo seed

| Perfil | E-mail | Área |
| --- | --- | --- |
| **Administrador** | `ti@cci.local` | TI — edita integrações, parâmetros e usuários |
| Simulador | `custos@cci.local` | Custos — cria cenários e simula |
| Validador | `controladoria@cci.local` | Controladoria — congela e consolida |
| Simulador | `fiscal@cci.local` · `pricing@cci.local` · `compras@cci.local` | consulta/simulação |
| Especialista | `industrial@cci.local` · `pcp@cci.local` | estrutura (S5) |
| Validador / Aprovador | `sgi@cci.local` · `negocio@cci.local` | validação técnica (S5) |

Senha inicial de todos: valor de `SEED_SENHA` no `.env` (padrão `cci@2026`) —
**troque no primeiro acesso** (tela Usuários, perfil TI).

## Deploy na VPS (AWS Ubuntu — aplicação + PostgreSQL na mesma instância)

```bash
git clone <este-repositório> && cd P009FCI
sudo bash scripts/install-vps.sh
```

O script instala Node 20 + PostgreSQL, cria papel/base `fci_app`/`fci_simulador`,
gera o `.env` com segredos, aplica migrações + seed e registra o serviço
systemd `fci-simulador`. Passo a passo manual e proxy Nginx/HTTPS em
[`docs/DEPLOY_VPS.md`](docs/DEPLOY_VPS.md).

## Integrações configuráveis (RF-090/RF-091)

As fontes de dados são cadastradas pelo administrador em **Integrações**:
host/endpoint, porta, base, usuário e credencial (cifrada com AES-256-GCM —
nunca exibida nem devolvida em texto claro), conector, frequência de
sincronização e o **mapeamento variável → tabela · campo** (ex.:
`produto.codigo → SB1.B1_COD`, `cst.cst → SD1.D1_CLASFIS`).

O seed aponta as cinco fontes (ERP Protheus, Portal de Custos, Sistema de
Preços, Câmbio e Compras) para o schema de demonstração `erp_demo` **na mesma
instância PostgreSQL** — para ligar nas origens reais basta o administrador
editar a conexão (ex.: conector `oracle`, host do Protheus) e ajustar o
mapeamento; nenhuma alteração de código é necessária. A sincronização executa
somente SELECTs: **nenhuma operação altera os sistemas de origem** (RNF-06), e
uma falha de integração mantém a última carga válida disponível (RF-095/RNF-07).

## Estrutura do repositório

```
server/            API Express (auth, cenários, fontes, parâmetros, usuários)
  connectors/      conectores abstratos postgres/oracle/mssql/mysql/rest/arquivo
  services/        catálogo de variáveis, sincronização, carga da estrutura, cenários
public/            SPA (js puro): telas Cenários, Simulação, Integrações,
                   Parâmetros, Alertas, Comparação, Usuários + motor CI% portado
sql/               001_schema.sql (schema fci) · 002_erp_demo.sql (origens demo)
scripts/           migrate, seed, install-vps.sh, unit systemd
test/              testes de fumaça dos critérios de aceite da Semana 1
docs/              escopo S1, deploy, protótipo de referência (handoff)
```

## Roadmap (cronograma de 6 semanas)

| Semana | Período | Entrega | Status |
| --- | --- | --- | --- |
| **S1** | 14/09 – 18/09 | Fundação de dados, parâmetros e cenário (RF-001/002/007, RF-090–100) | ✅ **entregue** |
| S2 | 21/09 – 25/09 | Estrutura, origem e classificação (cascata navegável ✅ prévia) | esqueleto pronto |
| S3 | 28/09 – 02/10 | Motor CI%, câmbio e denominador (motor portado ✅ prévia) | esqueleto pronto |
| S4 | 05/10 – 09/10 | Substituição de componentes e recálculo imediato | planejado |
| S5 | 12/10 – 16/10 | Validadores, perfis e alterações em massa | planejado |
| S6 | 19/10 – 23/10 | Comparação, alertas, relatório e aceite | planejado |

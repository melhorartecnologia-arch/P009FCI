# Simulador FCI · Cervejaria Cidade Imperial

Aplicação web para **criação, alteração e comparação de cenários de Conteúdo de
Importação (CI%)** dos produtos — apoio às decisões de Compras, Custos, Pricing,
Fiscal/Tributário, Industrial e Controladoria.

> **Ambiente analítico, sem validade fiscal.** Não gera, não assina e não
> transmite a Ficha de Conteúdo de Importação oficial, não constitui apuração
> tributária e não altera cadastros do Protheus (RN-12 · D-01 · seção "Fora de
> escopo" dos documentos de requisitos).

## Escopo implementado

**Os 100 requisitos funcionais (RF-001 a RF-100), as 12 regras de negócio
(RN-01 a RN-12) e os 10 requisitos não funcionais (RNF-01 a RNF-10)** da
Especificação de Requisitos de Software v1.0, equalizada com o Documento
Consolidado REV06.

| Bloco da ERS | Requisitos | Onde usar |
| --- | --- | --- |
| 6.1 Gestão de cenários e governança | RF-001 a RF-009 | Cenários · Simulação ▸ Governança |
| 6.2 Estrutura do produto | RF-010 a RF-014 | Simulação ▸ Estrutura |
| 6.3 Substituição de componentes | RF-015 a RF-024 | Simulação ▸ Estrutura (assistente ⇄) |
| 6.4 Validadores da estrutura | RF-025 a RF-033 | Simulação ▸ Validação |
| 6.5 Alterações avançadas e perfis | RF-034 a RF-039 | Simulação ▸ Governança · Permissões |
| 6.6 Alterações em massa | RF-040 a RF-045 | Simulação ▸ Alterações em massa |
| 6.7 Origem e conteúdo de importação | RF-046 a RF-051 | Simulação ▸ Origem e conteúdo |
| 6.8 Simulação cambial | RF-052 a RF-055 | Simulação ▸ Câmbio |
| 6.9 Cálculo do CI% e recálculo imediato | RF-056 a RF-065 | Simulação ▸ Cálculo |
| 6.10 Volumes, preços e destinos | RF-066 a RF-072 | Simulação ▸ Volumes e destinos |
| 6.11 Comparação de cenários | RF-073 a RF-082 | Comparação (matriz, drill-down, análise assistida) |
| 6.12 Alertas e relatório | RF-083 a RF-089 | Alertas · Relatório |
| 6.13 Dados mestres e integrações | RF-090 a RF-100 | Integrações · Parâmetros · Permissões |

Documentos do projeto:
- [`docs/MANUAL_USUARIO.pdf`](docs/MANUAL_USUARIO.pdf) — **manual do usuário**: passo a passo de
  todas as telas, com 18 capturas da aplicação (fonte em `docs/manual/manual.html`)
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — modelo de dados, motor e contrato da API
- [`docs/RASTREABILIDADE.md`](docs/RASTREABILIDADE.md) — matriz requisito × implementação × teste
- [`docs/DEPLOY_LIGHTSAIL.md`](docs/DEPLOY_LIGHTSAIL.md) · [`docs/DEPLOY_VPS.md`](docs/DEPLOY_VPS.md) — instalação

## Stack

- **100% Node.js + JavaScript**: Express no servidor, SPA em JavaScript puro
  (ESM, sem build, sem framework) no navegador.
- **PostgreSQL na mesma instância** da aplicação (VPS AWS Ubuntu/Lightsail).
- **Motor único compartilhado** (`shared/engine.mjs`): a mesma regra de cálculo,
  substituição e validação roda no navegador (prévia em tempo real) e no
  servidor (gravação e bloqueios) — garante aderência da fórmula (RNF-10).
- **Integrações configuráveis pelo administrador** com conector abstrato:
  PostgreSQL · Oracle (Protheus, modo *thin*) · SQL Server · MySQL · REST · arquivo.
- **Sem etapa de compilação**: todas as dependências são JavaScript puro ou
  trazem binários pré-compilados.

## Execução local

```bash
createdb fci_simulador
cp .env.example .env          # preencha PG* e gere FCI_SECRET_KEY / FCI_JWT_SECRET
npm install
npm run setup                 # migrações + carga de demonstração + 1ª sincronização
npm start                     # http://127.0.0.1:3000
npm test                      # regras de negócio + API + fumaça
```

### Usuários criados pelo seed

Senha inicial de todos: valor de `SEED_SENHA` no `.env` (padrão `cci@2026`) —
**troque no primeiro acesso** (tela Usuários, perfil TI).

| E-mail | Área | Perfil | Atribuição |
| --- | --- | --- | --- |
| `ti@cci.local` | TI | Administrador | Integrações, fontes de dados e parâmetros mestres |
| `custos@cci.local` | Custos | Simulador | Abre cenários, define premissas, calcula e consolida |
| `controladoria@cci.local` | Controladoria | Validador | Valida, aprova, congela e define a base do denominador |
| `fiscal@cci.local` | Fiscal | Simulador | Origem, CST, conteúdo, enquadramento e reemissão |
| `pricing@cci.local` | Pricing | Simulador | Preço de saída, volumes e mix de UF |
| `compras@cci.local` | Compras | Simulador | Fornecedor, FOB, frete, seguro, contratos e moeda |
| `industrial@cci.local` · `pcp@cci.local` | Industrial · PCP | Especialista | Estrutura e receita em modo avançado; validação técnica |
| `sgi@cci.local` | SGI/CGI | Validador | Validação técnica da estrutura e aprovação |
| `negocio@cci.local` | Negócio | Aprovador | Aprova e consolida para decisão executiva |

## Instalação na VPS

```bash
git clone <repositório> && cd P009FCI
sudo bash scripts/install-vps.sh
```

Instala Node 20 e PostgreSQL por pacote binário, cria papel e base, gera o
`.env` com segredos, aplica migrações e seed e registra o serviço systemd
`fci-simulador`. Passo a passo completo do AWS Lightsail (instância, IP
estático, firewall, Nginx, HTTPS) em [`docs/DEPLOY_LIGHTSAIL.md`](docs/DEPLOY_LIGHTSAIL.md).

## Integrações configuráveis

As fontes são cadastradas pelo administrador em **Integrações**: host/endpoint,
porta, base, usuário e credencial (cifrada em AES-256-GCM, nunca exibida em
texto claro), conector, frequência de sincronização e o **mapeamento variável →
tabela · campo** (ex.: `produto.codigo → SB1.B1_COD`, `cst.cst → SD1.D1_CLASFIS`).

O seed aponta as cinco fontes para o schema de demonstração `erp_demo` na mesma
instância PostgreSQL. Para ligar nas origens reais o administrador apenas edita
a conexão (ex.: conector `oracle` com o host do Protheus) e ajusta o mapeamento
— sem alteração de código. A sincronização executa **somente leitura**: nenhuma
operação altera os sistemas de origem (RNF-06), e uma falha preserva a última
carga válida (RF-095 · RNF-07).

## Estrutura do repositório

```
shared/engine.mjs    motor único: cálculo, substituição, validação, comparação,
                     alertas, relatório e análise assistida
server/              API Express — serviços por domínio, rotas REST, conectores
public/              SPA: cenários, simulação (8 abas), comparação, alertas,
                     relatório, integrações, parâmetros, permissões, usuários
sql/                 001 schema · 002 ERP de demonstração · 003 escopo completo
scripts/             migrate · seed · install-vps.sh · unit systemd
test/                engine (regras de negócio) · api (contrato) · smoke
docs/                manual, arquitetura, rastreabilidade, deploy, protótipo
```

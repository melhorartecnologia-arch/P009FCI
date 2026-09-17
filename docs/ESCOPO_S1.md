# Escopo entregue — Semana 1 (14/09 → 18/09)

Base: **Cronograma de Execução — Projeto Simulador FCI** (data-base 10/09,
execução 14/09–23/10) equalizado entre o Documento Consolidado REV06
(13/08) e a ERS v1.0 (30/07). A S1 é a *fundação de dados, parâmetros e
cenário* — gates **G1 (TI/Processos)** e marco **M1** em 18/09.

## Requisitos da S1 × implementação

| RF | Entrega | Critério de aceite (resumo do cronograma) | Implementação | Verificação |
| --- | --- | --- | --- | --- |
| **RF-001** Criar cenário | 15/09 | Identificador único, versão 1, status Rascunho, autor e data | `POST /api/cenarios` (`server/services/cenario.service.js`) · tela Cenários → “＋ Novo cenário” | teste `RF-001/RF-002` |
| **RF-090** Configuração da fonte de dados | 15/09 | Host/endpoint, porta, base, usuário e credencial editáveis; credencial nunca em texto claro | CRUD `api/fontes` + cofre AES-256-GCM (`server/crypto.js`); API devolve apenas máscara | teste `RF-090/RNF-05` |
| **RF-091** Mapeamento de dados | 15/09 | Cada variável aponta tabela e campo de origem (SB1.B1_COD, B1_DESC, B1_ORIGEM, SD1.D1_CLASFIS) | catálogo `server/services/catalogo.js` + `PUT /api/fontes/:id/mapeamentos` · modal “Mapeamento…” | teste `RF-091` |
| **RF-098** Faixas legais e fatores | 15/09 | Três faixas exibidas com limite, fator (0/0,5/1) e alíquota associada | parâmetro `faixas` + cards na tela Parâmetros; validação exige exatamente as 3 faixas e fatores legais | tela + validação 422 |
| **RF-007** Isolamento do cenário | 16/09 | Alteração em um cenário não altera outros nem o cadastro oficial | snapshot JSONB por cenário; conectores somente leitura | teste `RF-007` |
| **RF-092** Teste de conexão | 16/09 | Teste acionável altera o status e registra o momento | `POST /api/fontes/:id/testar` → `status`, `testado_em`, `teste_msg` | teste `RF-092` |
| **RF-096** Parâmetros do motor | 16/09 | MV_FCI, CFOP saída interestadual/interna/transferência e NF de complemento editáveis e persistidos | parâmetro `motor` (MV_FCICL/VE/VI/TR/COMP/NTHD) + tela Parâmetros | teste `RF-096/097/099` |
| **RF-097** Relação de alíquotas | 16/09 | Inclusão, alteração e exclusão de alíquotas aceitas pelo motor | parâmetro `aliquotas` + chips editáveis (MV_FCIALIQ) | teste `RF-096/097/099` |
| **RF-093** Sincronização manual e programada | 17/09 | Sincronização manual acionável e frequência programada visível por integração | `POST /api/fontes/:id/sincronizar` + agendador node-cron (manual/15min/horária/diária) e frequência no card | teste `RF-093/094` |
| **RF-094** Status da integração | 17/09 | Estados conectado, sincronizando e erro distinguíveis, com data/hora da última sincronização | campo `status` + chip com animação e “última sync” no card | teste `RF-093/094` |
| **RF-095** Falha sem parada | 17/09 | Integração em erro destacada e cenário operável sobre os dados já carregados | busca completa antes de gravar + transação única; erro destacado no card; staging preservado | teste `RF-095` |
| **RF-099** Gatilho de reemissão | 17/09 | Gatilho parametrizável em p.p. (padrão 5); alteração reflete nos alertas | parâmetro `gatilho_reemissao` + tela Alertas recalcula com o valor vigente | teste `RF-096/097/099` |
| **RF-002** Carregar estrutura do ERP | 18/09 | Ao abrir o cenário, lista técnica e cadastro refletem a origem integrada, sem digitação manual | `montarDadosDeOrigem` (staging → produtos/insumos/estrutura/saídas/câmbio) na criação e em “Recarregar estrutura do ERP” | teste `RF-001/RF-002` |
| **RF-100** Restrição de administração | 18/09 | Perfis não administradores acessam integrações e parâmetros em modo consulta, com indicação da restrição | middleware `exigirAcao` + banners 🔒 e campos desabilitados | teste `RF-100` |

**Marco M1 (18/09):** “cenário abre com estrutura integrada, sem digitação
manual” — demonstrável criando um cenário: 7 produtos (2 PI + 5 PA), 22
insumos, saídas por UF e câmbio carregados da sincronização.

## Decisões da equalização aplicadas

- **E-04 (regra de origem, padrão provisório até o gate G2 de 25/09):**
  origem `0=0%`, `1 e 2=100%`, `3=50%`, `4–7=0%`, `8=100%` inicializa a
  classificação/CI do item; o fator de faixa (0/0,5/1) é aplicado na cascata.
  Implementado em `classificacaoPorOrigem` (`server/services/catalogo.js`).
- **E-06:** quatro moedas parametrizáveis — dólar, euro, libra esterlina e
  franco suíço (parâmetro `moedas`).
- **E-07:** FOB, frete e seguro **manuais no cenário**; a carga aceita valores
  segregados apenas se a origem os fornecer (variáveis opcionais `custo.fob`…).
- **E-14:** fora de escopo — emissão/transmissão à SEFAZ, cadastro oficial,
  apuração no Protheus, movimentações posteriores de distribuidores.
- **RN-12:** avisos “sem validade fiscal” no login, no dashboard e nos alertas.

## Além da S1 (prévias já funcionais, sem compromisso de aceite)

- Motor de cálculo do CI% portado do protótipo (cascata, fatores, denominador
  por média ponderada das saídas — RN-01/02/03/05) alimentando as abas
  Estrutura e Cálculo — antecipação técnica das S2/S3.
- Prévia de alertas (faixa/reemissão/risco) usando o gatilho da S1.
- Duplicação de cenário como nova versão (RF-003 · S2).
- Aviso de CST divergente (E-05/RF-033 · S2) na aba Validação.
- Telas de Comparação/Massa marcadas com a semana de entrega correspondente.

## Não incluído (conforme cronograma)

- RC-004 (rendimento de insumos): **fora do pacote de construção** (D-06);
  quantidade da receita bloqueada no modo padrão — a nota técnica de
  governança é entrega de 23/10.
- Substituição de componentes (S4), validadores completos (S4/S5), modo
  avançado e matriz de permissões plena (S5), comparação/relatório/análise
  assistida (S6).

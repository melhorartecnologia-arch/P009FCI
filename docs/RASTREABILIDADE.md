# Matriz de rastreabilidade — requisito × implementação × verificação

Correlaciona cada requisito da **Especificação de Requisitos de Software v1.0**
(100 RF · 12 RN · 10 RNF), equalizada com o **Documento Consolidado REV06**
(RC-001 a RC-015), ao ponto do código que o implementa e ao teste que o
verifica.

Legenda das colunas:
- **Motor** — função de `shared/engine.mjs` que materializa a regra.
- **Servidor** — rota/serviço que expõe e persiste.
- **Tela** — onde o usuário exerce o requisito.
- **Teste** — `E` = `test/engine.test.js` · `A` = `test/api.test.js` · `S` = `test/smoke.test.js`.

## 6.1 Gestão de cenários e governança (RC-001 · RC-002 · RC-010 · RC-014)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-001 | Criar cenário | — | `POST /cenarios` · `cenario.service.criarCenario` | Cenários ▸ ＋ Novo cenário | A |
| RF-002 | Carregar estrutura de origem | — | `estrutura.service.montarDadosDeOrigem` · `POST /cenarios/:id/recarregar` | Cenários · Simulação ▸ Estrutura | A |
| RF-003 | Duplicar como nova versão | — | `POST /cenarios/:id/duplicar` | Cenários ▸ Duplicar | A |
| RF-004 | Painel de cenários | `resumoCenario` | `GET /cenarios` (indicadores) | Cenários | A |
| RF-005 | Congelar premissas | — | `POST /cenarios/:id/gov/congelar` | Simulação ▸ Governança | A |
| RF-006 | Versionamento e rastreabilidade | `diffs` | `GET /cenarios/:id/eventos` · `cenario_eventos` | Simulação ▸ Governança (linha do tempo) | A |
| RF-007 | Isolamento do cenário | `clonar` (toda operação devolve cópia) | `PUT /cenarios/:id/dados` (snapshot JSONB) | todas | E · A |
| RF-008 | Consolidar para decisão | `temErros` | `POST /cenarios/:id/gov/consolidar` | Simulação ▸ Governança | A |
| RF-009 | Encaminhamento às áreas | `direcionamentosPorArea` | `/cenarios/:id/gov/direcionamentos` | Relatório ▸ Direcionamentos | A |

## 6.2 Estrutura do produto (RC-007)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-010 | Estrutura em cascata MP→PI→PA | `computeNode` · `achatarEstrutura` | `GET /cenarios/:id/estrutura` | Simulação ▸ Estrutura | E · A |
| RF-011 | Quantidade da receita | — | `PUT /cenarios/:id/sim/componente/qtd` | Simulação ▸ Estrutura (modo avançado) | A |
| RF-012 | Custo industrial (overhead) | `computeNode` (overhead fora da parcela) | `PUT /cenarios/:id/sim/produto/overhead` | Simulação ▸ Estrutura (linha de totais) | E · A |
| RF-013 | Métricas por componente | `computeNode` (children) | `GET /cenarios/:id/estrutura` | Simulação ▸ Estrutura | E · A |
| RF-014 | Especificação técnica do SKU | `validar` (conferência de volume) | `estrutura.service` (`espec`) | Simulação ▸ Validação | E · A |

## 6.3 Substituição de componentes (RC-005)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-015 | Ação orientada de substituição | `aplicarSubstituicao` | `POST /cenarios/:id/sim/substituicao` | Estrutura ▸ assistente ⇄ | A |
| RF-016 | Substituição integral | `aplicarSubstituicao(modo:'integral')` | idem | assistente etapa 1 | E · A |
| RF-017 | Substituição parcial | `aplicarSubstituicao` · `ajustarProporcao` | `PUT .../substituicao/proporcao` | assistente etapa 3 | E · A |
| RF-018 | Cálculo das quantidades | `previaSubstituicao.quantidades` | `POST .../substituicao/previa` | assistente etapa 3 | E |
| RF-019 | Transparência das alternativas | `mixOf` (original permanece) | — | Estrutura ▸ linhas de alternativa | E · A |
| RF-020 | Tipos de troca | `opcoesSubstituicao` (naturezas) | `GET .../substituicao/opcoes` | assistente etapa 2 | E · A |
| RF-021 | Substituição de intermediário | `aplicarSubstituicao` (validação PI×MP) | idem | Estrutura (nó PI) | E |
| RF-022 | Prévia do efeito | `previaSubstituicao` | `POST .../substituicao/previa` | assistente etapa 4 | E · A |
| RF-023 | Ajuste de proporção na estrutura | `normalizarProporcoes` | `POST .../substituicao/normalizar` | Estrutura ▸ Normalizar | E |
| RF-024 | Reversão | `reverterSubstituicao` | `DELETE .../substituicao` | Estrutura ▸ Reverter | E · A |

## 6.4 Validadores da estrutura (RC-005)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-025 | Bloqueio por inconsistência | `diagnostico.bloqueado` · `motivo` | congelar/consolidar devolvem 409 | Validação (banner) | E · A |
| RF-026 | Componentes obrigatórios | `validar` (tipo `obrigatorio`) | `GET /cenarios/:id/validacao` | Validação | E |
| RF-027 | Quantidade por grupo | `validar` (tipo `quantidade` + tolerância) | idem | Validação | E |
| RF-028 | Soma das proporções = 100% | `validar` (tipo `proporcao`) | idem | Validação · Estrutura | E |
| RF-029 | Distribuição vs original | `validar` (tipo `distribuicao`) | idem | Validação | E |
| RF-030 | Integridade técnica | `validar` (tipo `especificacao`) | idem | Validação | E |
| RF-031 | Confronto imediato | `confrontarEdicao` | toda rota de alteração devolve `confronto` | modal de confronto | E |
| RF-032 | Diagnóstico consolidado | `diagnostico.grupos` | `GET /cenarios/:id/validacao` | Validação | E |
| RF-033 | Coerência fiscal | `validar` (tipo `cst`) | idem | Validação · Origem e conteúdo | E |

## 6.5 Alterações avançadas da receita e perfis (RC-004 · RC-009)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-034 | Modalidade avançada | — | `PUT /cenarios/:id/sim/modo` | Governança ▸ alternador de modo | A |
| RF-035 | Controle por perfil | `permissions.pode` | `exigirAcao` → 403 com impedimento | botões desabilitados com motivo | A |
| RF-036 | Submissão à validação | `diffs` · `exigeValidacaoTecnica` | `POST .../gov/validacao/submeter` | Governança ▸ pontos alterados | E · A |
| RF-037 | Decisão de validação | — | `POST /validacoes/:vid/decidir` | Governança ▸ histórico | A |
| RF-038 | Consolidação condicionada | `exigeValidacaoTecnica` | consolidar devolve 409 sem aprovação | Governança | A |
| RF-039 | Matriz de permissões | `CAPACIDADES_MATRIZ` | `GET /permissoes/matriz` | Permissões | A |

## 6.6 Alterações em massa (RC-003)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-040 | Substituição em lote por grupo | `gruposDeInsumo` · `posicoesDoGrupo` | `GET .../massa/grupos` | Alterações em massa ▸ passo 1 | E · A |
| RF-041 | Proporção por grupo | `aplicarMassa` | `POST .../massa/aplicar` | passo 3 | E |
| RF-042 | Seleção de estruturas | `previaMassa(prodIds)` | idem | lista de estruturas | E |
| RF-043 | Prévia do lote | `previaMassa.impactos` | `POST .../massa/previa` | prévia | E · A |
| RF-044 | Alteração pontual preservada | — | rota individual permanece ativa | aviso na tela | A |
| RF-045 | Operação sem efeito | `previaMassa.semEfeito` | prévia devolve `aplicavel:false` | botão desabilitado com motivo | E · A |

## 6.7 Origem e conteúdo de importação do insumo (RC-015)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-046 | Classificação do item | `CLASSES` | `PUT .../sim/insumo` | Origem e conteúdo (legenda) | E |
| RF-047 | Origem do cadastro como referência | `classificacaoPorOrigem` | `estrutura.service` (`origemErp`) | Origem e conteúdo | E |
| RF-048 | Percentual e faixa | `nodeInfo` | `PUT .../sim/insumo` | Origem e conteúdo | E |
| RF-049 | Bloqueio de campos de item nacional | `nodeInfo` (ignora CI) | `PUT .../sim/insumo` devolve 422 | campos desabilitados | E · A |
| RF-050 | CST sugerido | `cstSugerido` | `PUT .../sim/insumo` → `cstSugerido` | Origem e conteúdo | E · A |
| RF-051 | Separação origem × percentual | campos próprios no modelo | idem | Origem e conteúdo | E |

## 6.8 Simulação cambial (RC-011)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-052 | Moedas parametrizáveis | `MOEDAS` | `PUT .../sim/cambio` · parâmetro `moedas` | Câmbio | E · A |
| RF-053 | Vínculo insumo-moeda | `insumosPorMoeda` | resposta de `PUT .../sim/cambio` | Câmbio (lista vinculada) | A |
| RF-054 | Recálculo em lote | `custoFCI` (usa a cotação do cenário) | idem | Câmbio | E · A |
| RF-055 | Alternativa cadastral | — | `POST .../sim/insumo/alternativa` | Câmbio ▸ Incluir alternativa | A |

## 6.9 Cálculo do CI% e recálculo imediato (RC-012)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-056 | Fórmula e versão | `resultadoProduto` · `VERSAO_FORMULA_PADRAO` | `GET /cenarios/:id/resultado` | Cálculo (memória) | E · A |
| RF-057 | Cascata e fatores | `computeNode` | idem | Estrutura (coluna ×fator) | E |
| RF-058 | Custo FCI | `custoFCI` · `memoriaCustoFCI` | idem | Câmbio · Cálculo | E |
| RF-059 | Valor aduaneiro | `valorAduaneiro` | `PUT .../sim/insumo` | Câmbio ▸ composição | E |
| RF-060 | Denominador parametrizável | `resultadoProduto(base)` | `PUT /cenarios/:id/base` | Cálculo ▸ seletor de base | E · A |
| RF-061 | Enquadramento e alíquota | `enquadramento` · `aliqInter` | `GET /cenarios/:id/resultado` | Cálculo · topo fixo | E · A |
| RF-062 | Impacto ICMS-ST | `icmsST` | idem | Cálculo | E · A |
| RF-063 | Recálculo imediato | toda alteração recalcula e devolve | todas as rotas `/sim` | todas as abas | A |
| RF-064 | Exibição contínua do CI% | — | — | topo fixo da simulação | — |
| RF-065 | Maior contribuição | `maioresContribuicoes` | `GET /cenarios/:id/resultado` | Cálculo | E · A |

## 6.10 Volumes, preços e destinos (RC-013)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-066 | Volumes por UF | `precoMedio` | `estrutura.service` (`saidas`) | Volumes e destinos | E |
| RF-067 | Carga do Sistema de Preços | — | `POST .../sim/saidas/carga` (substituir · complementar) | Volumes e destinos | A |
| RF-068 | Ajuste no cenário | `resultadoProduto` | `PUT .../sim/saidas` | Volumes e destinos | E · A |
| RF-069 | Média ponderada nacional | `resultadoProduto` (não segmenta por UF) | — | aviso na tela | E |
| RF-070 | Peso por UF | `pesosUF` | `GET /cenarios/:id/resultado` | Volumes e destinos | E |
| RF-071 | Sensibilidade por UF | `sensibilidadeUF` | `GET .../sim/sensibilidade/uf` | Volumes e destinos | E |
| RF-072 | Escopo da saída | — | — | aviso na tela de volumes | — |

## 6.11 Comparação de cenários (RC-006 · RC-007 · RC-008 · RC-017)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-073 | Seleção de cenários (limite 10) | `LIMITE_COMPARACAO` | `PUT /comparacao/selecao` | Comparação ▸ chips | E · A |
| RF-074 | Matriz de CI% | `matrizComparativa` | `GET /comparacao/matriz` | Comparação ▸ matriz | E · A |
| RF-075 | Drill-down | `drillDown` (`expansivel`) | `GET /comparacao/drill` | Comparação ▸ árvore | E · A |
| RF-076 | Grau de impacto em p.p. | `drillDown` (`contribPp` · `ressalva`) | idem | Comparação ▸ árvore | E · A |
| RF-077 | Sensibilidade entre cenários | `serieComparativa` | `GET /comparacao/serie` | Comparação ▸ gráfico | E · A |
| RF-078 | Edição sem sair da tela | — | `PUT /comparacao/painel` | painel lateral | A |
| RF-079 | Recálculo ao vivo | `matrizComparativa` | `PUT /comparacao/painel` devolve matriz | painel lateral | A |
| RF-080 | Análise assistida por conversa | `responderAnalise` | `POST /analise` · `analise_mensagens` | Comparação ▸ Análise | E · A |
| RF-081 | Análises padrão | `analisesPadrao` (7) · `caminhoAbaixoDe` · `sensibilidadeCambial` | `GET /analise/padrao` | Comparação ▸ sugestões | E · A |
| RF-082 | Ressalva de uso | `RESSALVA_GERENCIAL` | toda resposta de `/analise` | rodapé de cada resposta | E · A |

## 6.12 Alertas e relatório (RC-014 · RC-016)

| RF | Requisito | Motor | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- | --- |
| RF-083 | Mudança de faixa | `alertas` (tipo `faixa`) | `GET /cenarios/:id/alertas` | Alertas | E · A |
| RF-084 | Reemissão da FCI | `alertas` (tipo `reemissao`) | idem | Alertas | E · A |
| RF-085 | Risco fiscal | `alertas` (tipo `risco` + base legal) | idem | Alertas | E · A |
| RF-086 | Encaminhamento | `alertas[].area` | idem | Alertas (área responsável) | E · A |
| RF-087 | Relatório executivo | `relatorioExecutivo` | `GET /cenarios/:id/relatorio` | Relatório | E · A |
| RF-088 | Direcionamentos por área | `direcionamentosPorArea` | idem | Relatório ▸ 3 blocos | E · A |
| RF-089 | Exportação em PDF | — | `GET /cenarios/:id/relatorio/pdf` (pdfkit) | Relatório ▸ Exportar PDF | A |

## 6.13 Dados mestres, integrações e parâmetros (RC-015 · RC-009)

| RF | Requisito | Servidor | Tela | Teste |
| --- | --- | --- | --- | --- |
| RF-090 | Configuração da fonte | `fontes.routes` · `crypto.cifrar` | Integrações | S |
| RF-091 | Mapeamento de dados | `catalogo.VARIAVEIS` · `mapeamentos` | Integrações ▸ Mapeamento | S |
| RF-092 | Teste de conexão | `sync.service.testarConexao` | Integrações ▸ Testar | S |
| RF-093 | Sincronização | `sync.service.sincronizar` + node-cron | Integrações ▸ Sincronizar | S |
| RF-094 | Status da integração | campo `status` + `last_sync_at` | Integrações (chip) | S |
| RF-095 | Falha sem parada | busca completa antes de gravar + transação | Integrações (erro destacado) | S |
| RF-096 | Parâmetros do motor | `parametros.routes` (chave `motor`) | Parâmetros ▸ MV_FCI | S |
| RF-097 | Alíquotas | chave `aliquotas` | Parâmetros ▸ MV_FCIALIQ | S |
| RF-098 | Faixas e fatores | chave `faixas` | Parâmetros ▸ faixas legais | S |
| RF-099 | Gatilho de reemissão | chave `gatilho_reemissao` | Parâmetros ▸ gatilho | S · A |
| RF-100 | Restrição de administração | `permissions.ACOES_ADMIN` · `exigirAcao` | banners de consulta | S · A |

## Regras de negócio

| RN | Regra | Onde | Teste |
| --- | --- | --- | --- |
| RN-01 | CI% = parcela importada ÷ denominador × 100 | `resultadoProduto` | E |
| RN-02 | Denominador = média ponderada global das saídas interestaduais | `precoMedio` · `resultadoProduto` | E |
| RN-03 | Custo FCI = entrada − ICMS − IPI (PIS/COFINS não deduzem) | `custoFCI` | E |
| RN-04 | Importado direto e estrangeiro no mercado interno = conteúdo integral | `nodeInfo` | E |
| RN-05 | Fatores de faixa 0 · 0,5 · 1 | `fator` | E |
| RN-06 | Enquadramento nas quatro situações | `faixaDe` · `enquadramento` | E |
| RN-07 | CI% > 40% ⇒ alíquota de 4% | `aliqInter` | E |
| RN-08 | Reemissão além do gatilho (padrão 5 p.p.) | `alertas` | E · A |
| RN-09 | Proporções = 100% e quantidades = receita | `validar` · `previaSubstituicao` | E |
| RN-10 | Premissas congeladas não são editáveis | `garantirEditavel` → 409 | A |
| RN-11 | Alteração de receita exige validação da estrutura | `exigeValidacaoTecnica` · consolidar | E · A |
| RN-12 | Não transmite nem substitui a FCI oficial | `RESSALVA_GERENCIAL` · avisos nas telas e no PDF | E |

## Requisitos não funcionais

| RNF | Categoria | Como é atendido |
| --- | --- | --- |
| RNF-01 | Desempenho | Motor síncrono em memória; toda alteração devolve o resultado recalculado na mesma resposta |
| RNF-02 | Usabilidade | Interface desktop densa; CI%, faixa e alíquota fixos no topo em todas as abas |
| RNF-03 | Idioma | Interface, mensagens de erro e formatação numérica em português do Brasil |
| RNF-04 | Rastreabilidade | `cenario_eventos`, `parametros_hist`, `sync_execucoes`, `validacoes_tecnicas` |
| RNF-05 | Segurança | Credenciais em AES-256-GCM; API devolve apenas máscara; edição restrita ao Administrador |
| RNF-06 | Integridade | Conectores executam somente leitura; cenários gravam apenas no próprio snapshot |
| RNF-07 | Disponibilidade dos dados | Sincronização busca tudo antes de gravar; falha preserva a última carga válida |
| RNF-08 | Auditabilidade | `memoriaCalculo` e `memoriaCustoFCI` demonstram o cálculo até o insumo |
| RNF-09 | Governança de acesso | Matriz de permissões por área e perfil, com efeito imediato nos campos |
| RNF-10 | Conformidade | Motor único compartilhado entre tela e servidor; versão da fórmula registrada no cenário |

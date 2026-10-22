# Arquitetura e contrato interno — Simulador FCI

Documento técnico de referência da construção. Define o modelo de dados do
cenário, o motor compartilhado, o contrato da API e as convenções do
front-end. Serve de guia para manutenção e evolução pela equipe de TI.

## 1 · Camadas

```
shared/engine.mjs      motor único (ESM) — cálculo, substituição, validação,
                       comparação, alertas, relatório e análise assistida.
                       Importado pelo navegador (/shared/engine.mjs) e pelo
                       servidor (server/engine.js, import dinâmico no boot).
server/                Express + PostgreSQL. Serviços por domínio e rotas REST.
public/                SPA em JavaScript puro (ESM, sem build).
sql/                   001 schema · 002 ERP de demonstração · 003 escopo completo
```

Regra de ouro: **toda regra de negócio vive no motor**. Servidor e telas apenas
orquestram. Isso garante que a prévia exibida e a validação gravada apliquem
exatamente o mesmo cálculo (RNF-10).

## 2 · Modelo de dados do cenário (`cenarios.dados`, JSONB)

```js
{
  base: 'saida' | 'custo',          // RF-060 — denominador vigente
  cambio:       { USD: 5.42, ... }, // RF-052 — cotação por moeda no cenário
  cambioPadrao: { USD: 5.42, ... }, // referência da carga (RF-036)
  fornecedores: [{ id, nome, pais }],
  insumos: [{
    id, codigo, nome, unidade, grupo,
    classSim: 'nacional'|'importado_direto'|'estrangeiro_mi'|'nacional_ci', // RF-046
    classPadrao, origemCad, origemErp,        // RF-047 origem do cadastro
    fornecedorId, cstErp, cstOrigem, classFiscal,  // RF-050 / RF-033
    ciModo: 'pct'|'faixa', ciFaixa, ciPct, ciPadrao, // RF-048 / RF-051
    moeda, fob, freteInt, seguroInt, ii, ipiImp, pisCofinsImp, // RF-059
    precoNacional, precoPadrao, icms, ipi,    // RF-058
    alt: false                                 // RF-055 alternativa cadastral
  }],
  produtos: [{
    id, sku, nome, tipo: 'PA'|'PI', grupo, unidade,
    overhead, overheadPadrao,                  // RF-012
    espec: { descr, volume, unidVol } | null,  // RF-014
    obrig: [{ grupo, qtd, unidade, tol }],     // RF-026 / RF-027
    componentes: [{ ref, qtd, qtdPadrao, mix?: [{ ref, pct }] }], // RF-010 / RF-016..019
    saidas: [{ uf, volume, preco, volumePadrao, precoPadrao }],   // RF-066
    fciVigente                                  // RF-083 / RF-084
  }],
  origemCarga: [{ codigo, nome, syncEm }], carregadoEm
}
```

`mix` só existe quando há substituição; o **primeiro elemento é sempre o item
original** e permanece listado mesmo com proporção zero (RF-019).

## 3 · Motor compartilhado — funções por requisito

| Requisito | Função |
| --- | --- |
| RF-010 · RF-013 · RF-057 | `computeNode`, `achatarEstrutura` |
| RF-056 · RF-060 · RF-064 | `resultadoProduto`, `memoriaCalculo` |
| RF-058 · RF-059 | `custoFCI`, `valorAduaneiro`, `memoriaCustoFCI` |
| RF-061 · RN-06/07 | `enquadramento`, `faixaDe`, `aliqInter` |
| RF-062 | `icmsST` |
| RF-065 | `maioresContribuicoes` |
| RF-066 · RF-070 · RF-071 | `precoMedio`, `pesosUF`, `sensibilidadeUF` |
| RF-015..RF-024 | `opcoesSubstituicao`, `previaSubstituicao`, `aplicarSubstituicao`, `ajustarProporcao`, `normalizarProporcoes`, `reverterSubstituicao` |
| RF-025..RF-033 | `validar`, `diagnostico`, `temErros`, `confrontarEdicao` |
| RF-036 | `diffs`, `exigeValidacaoTecnica` |
| RF-040..RF-045 | `gruposDeInsumo`, `itensDoGrupo`, `posicoesDoGrupo`, `previaMassa`, `aplicarMassa` |
| RF-004 | `resumoCenario` |
| RF-052..RF-055 | `insumosPorMoeda` |
| RF-073..RF-077 | `matrizComparativa`, `drillDown`, `serieComparativa` |
| RF-080..RF-082 | `analisesPadrao`, `responderAnalise`, `RESSALVA_GERENCIAL` |
| RF-083..RF-086 | `alertas` |
| RF-087..RF-088 | `relatorioExecutivo`, `direcionamentosPorArea` |
| RF-039 | `CAPACIDADES_MATRIZ` (+ `server/permissions.matrizPermissoes`) |
| apoio RF-081 | `caminhoAbaixoDe`, `sensibilidadeCambial` |

Formatadores pt-BR exportados: `num`, `pct`, `brl`, `pp`, `n`, `clonar`.

## 4 · Contrato da API

Todas as rotas exigem `Authorization: Bearer <jwt>`; erros devolvem
`{ erro: string }` com status 4xx/5xx e mensagem em português (RNF-03).
`exigirAcao('capacidade')` devolve **403** com a mensagem de impedimento
quando o perfil não tem a capacidade (RF-035 · RF-100).

### 4.1 Cenários — `/api/cenarios`
| Método | Rota | Capacidade | Requisito |
| --- | --- | --- | --- |
| GET | `/` | — | RF-004 lista com indicadores |
| POST | `/` | criarCenario | RF-001 |
| GET | `/:id` | — | abre cenário + resultado |

`GET /:id` devolve o pacote completo da tela de simulação:

```
{ cenario, parametros, validacao, resumo, exigeValidacaoTecnica,
  governanca: { exigeValidacao, liberaConsolidacao, aprovadaVigente, pendente } }
```

`governanca.liberaConsolidacao` é o MESMO critério aplicado por
`POST /:id/gov/consolidar` (RF-038 · RN-11): a tela decide o bloqueio do botão
por ele, nunca por contagem própria de diffs — a aprovação técnica não apaga o
diff da receita, de modo que contar alterações não diz se já foram aprovadas.
Como uma edição posterior à aprovação pode invalidá-la, a aba de Governança
confronta esse estado com `GET /:id/gov/validacao/historico`, que é a fonte
autoritativa, e se redesenha quando divergirem.

| PUT | `/:id/dados` | salvar | RF-007 |
| POST | `/:id/recarregar` | salvar | RF-002 |
| POST | `/:id/duplicar` | criarCenario | RF-003 |
| PUT | `/:id/base` | baseCalculo | RF-060 |
| POST | `/:id/congelar` | congelar | RF-005 |
| POST | `/:id/consolidar` | consolidar | RF-008 |
| GET | `/:id/eventos` | — | RF-006 |
| GET | `/:id/validacao` | — | RF-025 · RF-032 |
| GET | `/:id/diffs` | — | RF-036 |
| GET | `/:id/alertas` | — | RF-083..086 |
| GET | `/:id/estrutura?prodId=` | — | RF-010 · RF-013 |
| GET | `/:id/resultado?prodId=` | — | RF-056 · RF-064 |

### 4.2 Simulação — `/api/cenarios/:id/sim`
| Método | Rota | Capacidade | Requisito |
| --- | --- | --- | --- |
| GET | `/substituicao/opcoes?prodId&idx` | — | RF-020 |
| POST | `/substituicao/previa` | — | RF-022 |
| POST | `/substituicao` | substituir | RF-015..018 · RF-021 |
| PUT | `/substituicao/proporcao` | substituir | RF-017 · RF-023 |
| POST | `/substituicao/normalizar` | substituir | RF-023 |
| DELETE | `/substituicao` | substituir | RF-024 |
| PUT | `/componente/qtd` | modoAvancado | RF-011 |
| PUT | `/produto/overhead` | modoAvancado | RF-012 |
| PUT | `/insumo` | editarFiscal\|editarFornecedor | RF-046..051 · RF-059 |
| POST | `/insumo/alternativa` | editarFornecedor | RF-055 |
| PUT | `/cambio` | editarFornecedor | RF-052 · RF-054 |
| PUT | `/saidas` | editarSaida | RF-066 · RF-068 |
| POST | `/saidas/carga` | editarSaida | RF-067 |
| GET | `/sensibilidade/uf?prodId&variacao` | — | RF-071 |
| GET | `/massa/grupos` | — | RF-040 |
| POST | `/massa/previa` | massa | RF-043 · RF-045 |
| POST | `/massa/aplicar` | massa | RF-041 · RF-042 |
| PUT | `/modo` | modoAvancado | RF-034 · RF-035 |

Toda rota que altera o cenário responde `{ cenario, validacao, confronto? }`,
onde `confronto` traz as inconsistências NOVAS geradas pela edição (RF-031).

### 4.3 Governança — `/api/cenarios/:id/gov` e `/api/validacoes`
| Método | Rota | Capacidade | Requisito |
| --- | --- | --- | --- |
| POST | `/validacao/submeter` | submeterValidacao | RF-036 |
| GET | `/validacao/historico` | — | RF-037 |
| POST | `/api/validacoes/:vid/decidir` | validarTecnico | RF-037 · RF-038 |
| GET/POST/DELETE | `/direcionamentos` | consolidar | RF-009 · RF-088 |

### 4.4 Comparação — `/api/comparacao`
| Método | Rota | Requisito |
| --- | --- | --- |
| GET | `/` | seleção atual + matriz |
| PUT | `/selecao` | RF-073 (limite 10) |
| GET | `/matriz?ids&base` | RF-074 |
| GET | `/drill?cenarioId&prodId` | RF-075 · RF-076 |
| GET | `/serie?ids&prodId` | RF-077 |
| PUT | `/painel` | RF-078 · RF-079 |

### 4.5 Análise assistida — `/api/analise`
| Método | Rota | Requisito |
| --- | --- | --- |
| GET | `/padrao` | RF-081 |
| POST | `/` | RF-080 · RF-082 |
| GET | `/historico?contexto` | RF-080 |
| DELETE | `/historico?contexto` | RF-080 — limpa a conversa do recorte |

### 4.6 Relatório — `/api/cenarios/:id/relatorio`
| Método | Rota | Capacidade | Requisito |
| --- | --- | --- | --- |
| GET | `/` | relatorio | RF-087 · RF-088 |
| GET | `/pdf` | relatorio | RF-089 |

### 4.7 Outras
`GET /api/permissoes/matriz` (RF-039) · `/api/fontes` (RF-090..095) ·
`/api/parametros` (RF-096..099) · `/api/usuarios` · `/api/saude`.

## 5 · Convenções do front-end

- SPA ESM sem build. Views em `public/js/views/*.js`, cada uma exportando
  `export async function telaX(el, ctx, params)`.
- `ctx` oferece: `api` (`get/post/put/del`), `usuario` (com `acoes`),
  `navegar(hash)`, `toast(msg, 'ok'|'erro')`, `abrirModal(html)`,
  `fecharModal()`, `definirTopo(titulo, sub, contextoHtml)`, `definirAlertas(n)`,
  `pode(acao)`.
- O motor é importado diretamente pelas telas: `import * as E from '/shared/engine.mjs'`.
- Classes CSS disponíveis em `public/css/app.css` (ver seção "Componentes").
- Mensagens e rótulos sempre em português do Brasil (RNF-03); valores
  numéricos pelos formatadores do motor.

## 6 · Regras invioláveis

1. Nenhuma operação altera as bases de origem — conectores só leem (RNF-06).
2. Cenário congelado ou consolidado recusa edição com HTTP 409 (RN-10).
3. Consolidação é recusada com erro de validação pendente (RF-008 · RF-025) ou
   com alteração de receita não aprovada (RF-038 · RN-11).
4. Credencial de integração nunca sai da API em texto claro (RNF-05).
5. Toda alteração relevante gera evento em `cenario_eventos` (RNF-04).

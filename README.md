# 💰 SalvaMoney Bot — WhatsApp

Bot que registra gastos via WhatsApp e salva direto no Firebase..

## Recursos

- Registro de gastos por texto, áudio e imagem
- Parcelamento com lançamentos nos meses seguintes
- Resumo mensal, resumo do dia e listagem dos últimos gastos
- Dashboard simples para consultar e apagar gastos
- Suporte à Evolution API
- Assistente conversacional com IA (DeepSeek), com consentimento individual
- Seis personalidades de conversa
- Amigos por tag e apelido, divisões de contas e cobranças com confirmação
- Vários cartões com ciclo estimado de fatura e parcelamentos
- Consultoria financeira determinística e pesquisa de investimentos com fontes
- Lembretes de fechamento e vencimento, relatório semanal com personalidade

Cada recurso novo tem uma feature flag própria (veja [Feature flags e rollback](#feature-flags-e-rollback)).

## 🚀 Deploy no Railway (grátis)

### 1. Crie conta no Railway
Acesse: https://railway.app e entre com GitHub.

### 2. Suba os arquivos
- Crie um repositório no GitHub com esses arquivos
- No Railway: New Project → Deploy from GitHub Repo

### 3. Configure as variáveis de ambiente
No Railway, vá em **Variables** e adicione cada linha do `.env`.

Use `.env.example` como base. Mantenha tokens reais fora do repositório.

Variáveis novas para produção (detalhes no `.env.example`):

- IA: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `GROQ_FALLBACK_MODEL`, `AI_CONSENT_VERSION`
- Pesquisa: `BRAVE_API_KEY`
- Custos: `AI_MONTHLY_BUDGET_BRL` e divisão por categoria, `ADMIN_PHONE`, `USD_BRL_RATE` e as tarifas `*_PRICE_*` (obrigatórias para qualquer chamada externa, inclusive áudio e imagem)
- Modelo Groq: `GROQ_MODEL=openai/gpt-oss-20b` (o antigo `llama-3.1-8b-instant` foi desativado nos planos Free/Developer)
- Flags: `FEATURE_*` (cada uma com `true` explícito)
- Timeouts/schedulers: `AI_*_MS`, `DEEPSEEK_TIMEOUT_MS`, `BRAVE_TIMEOUT_MS`, `PROACTIVE_*`

O scheduler do relatório semanal automático fica ativo por padrão e envia somente para contas que fizeram opt-in pelo WhatsApp. Para desativar a rotina no processo, configure:

```env
WEEKLY_REPORT_SCHEDULER_ENABLED=false
```

### 4. Pegue a URL do servidor
O Railway vai gerar uma URL tipo:
`https://salvamoney-bot-production.up.railway.app`

### 5. Configure o Webhook na Evolution API
No painel da Evolution API:
- Vá em **Webhooks**
- Cole a URL: `https://SUA-URL.railway.app/webhook`
- Ative o evento de mensagens: **messages.upsert**

---

## 💬 Comandos do Bot

| Mensagem | O que faz |
|---|---|
| `entrar João CASA2024` | Vincula o número ao usuário/grupo |
| `trocar conta Ana CASA2024` | Troca o vínculo atual para outro usuário/grupo |
| `gastei 50 almoço` | Registra R$50 em Alimentação |
| `35 uber` | Registra R$35 em Transporte |
| `mercado 120,50` | Registra R$120,50 em Alimentação |
| `resumo` | Mostra total do mês por categoria |
| `quanto gastei hoje?` | Mostra o total e os gastos recentes do dia |
| `listar gastos` | Mostra até 10 gastos recentes do mês |
| `configurar relatório semanal sábado 9h` | Muda dia e hora do relatório automático (padrão domingo 20h) |
| `ajuda` | Mostra todos os comandos |

Os comandos dos recursos novos estão nas seções abaixo.

---

## 🤖 Arquitetura de IA

| Responsável | Função |
|---|---|
| Código local | regras, parsers, cálculos, permissões, validações e gravações |
| DeepSeek (`deepseek-flash`) | interpretação complexa e redação (somente com consentimento) |
| Groq Whisper | transcrição de áudio |
| GPT-OSS na Groq | fallback textual quando a DeepSeek falha ou demora |
| Brave Search API | pesquisa atual de investimentos, só quando o usuário pede |

Fluxo de toda mensagem:

1. Regras e parsers determinísticos tentam primeiro (gastos, divisões, cobranças, cartões etc.).
2. Se necessário, o contexto **sanitizado** vai para a IA.
3. A IA devolve só intenção/ação estruturada em JSON.
4. O backend valida esquema, usuário, permissões, valores e estado.
5. Ações ambíguas ou sensíveis mostram uma **prévia** e pedem `sim`.
6. Somente o backend grava no Firebase — o modelo nunca acessa o banco.

Garantias:

- **Idempotência:** cada mensagem do webhook usa o `messageId` como chave (gravada como hash). Retry, webhook repetido após reinício, `sim` duplicado ou resposta duplicada do modelo não duplicam gravações.
- **Timeouts e fallback:** texto comum com teto de ~3 s, pesquisa ~12 s, áudio/imagem ~20 s. Uma única nova tentativa só em erro transitório (nunca em loop) e circuit breaker por provedor.
- **Falha de IA nunca bloqueia** registro, correção, consulta ou exclusão de gastos: essas rotas são determinísticas e rodam antes da IA.
- **Logs técnicos** da IA contêm só tarefa, provedor, duração, status, tokens e custo estimado. Erros registram apenas status/código.

## 💸 Controle de custos

- Teto mensal padrão de **R$ 60**: R$ 35 DeepSeek, R$ 10 pesquisa, R$ 15 reserva/fallback (tudo configurável).
- Aos **80%**, o administrador (`ADMIN_PHONE`) recebe um aviso (uma vez por mês). No limite, novas chamadas externas são bloqueadas; funções locais continuam.
- Nenhum preço de provedor está fixo no código: configure as tarifas (`*_PRICE_*`) e o câmbio (`USD_BRL_RATE`). **Sem tarifa, a chamada fica bloqueada** em qualquer provedor (DeepSeek, Brave e Groq — texto, áudio e imagem), para o teto ser rígido.
- Antes de cada chamada o custo é estimado; se ele estourar o teto do mês ou da categoria, a chamada não acontece. O Whisper é cobrado pela duração real do áudio (`GROQ_AUDIO_PRICE_USD_PER_HOUR`, mínimo de 10 s).
- O consumo fica em `sistema/custosIA/{AAAA-MM}` (totais e contagem, sem conteúdo).

## 🔒 Consentimento e privacidade

Antes do primeiro recurso com DeepSeek, o bot mostra um aviso curto e pede `aceito`. Ficam guardados estado, versão (`AI_CONSENT_VERSION`) e data. Mudar a versão pede novo aceite.

Enviado à IA: valores agregados, percentuais, categorias padrão, prazos e dados calculados. **Nunca** vão: nome, telefone, e-mail, tag, apelidos (viram `PESSOA_1`), identificadores do Firebase, descrições das transações nem histórico bruto. Há uma camada de redação no gateway como trava final.

O contexto da conversa fica **só em memória**: últimas 6 mensagens ou ~24 h. No Firebase ficam apenas dados financeiros informados, preferências e configurações.

| Mensagem | O que faz |
|---|---|
| `ativar IA` / `desativar IA` | Pede aceite / revoga o consentimento e apaga o contexto |
| `ativar pesquisa externa` / `desativar pesquisa externa` | Controla a pesquisa com a Brave |
| `privacidade` | Mostra o estado da IA e da pesquisa |
| `meus dados` | Resume o que está armazenado |
| `exportar meus dados` | Envia um JSON com seus dados (sem telefones) |
| `apagar meus dados` | Pede a frase `APAGAR MEUS DADOS 123456` (10 min) e apaga tudo |
| `limpar conversa` | Apaga o contexto da IA |

## 🎭 Personalidades

`Equilibrado` (padrão), `Econômico`, `Estrategista`, `Motivador`, `Professor` e `Sincerão`. A personalidade muda só tom e apresentação — nunca cálculos, permissões, segurança ou política de investimento. Vale também para alertas e relatório semanal. O Econômico só comenta um gasto quando há orçamento, meta ou prioridade definida, sempre com o impacto em números.

| Mensagem | O que faz |
|---|---|
| `personalidades` | Lista as seis |
| `testar personalidade sincerão` | Mostra um exemplo |
| `mudar personalidade para professor` · `quero o modo econômico` | Troca |
| `minha personalidade` | Mostra a atual |

## 👥 Amigos

A tag de 6 dígitos continua sendo o identificador interno; o apelido é uma camada local de cada usuário.

| Mensagem | O que faz |
|---|---|
| `adicionar amigo 123456` | Envia convite (o outro lado recebe só primeiro nome e tag) |
| `aceitar amigo 123456` · `recusar amigo 123456` | Responde ao convite |
| `apelido Carlos` · `apelido 123456 Carlos trabalho` | Define o apelido local (único; nomes repetidos pedem outro, nunca "Carlos 2") |
| `renomear Carlos para Carlão` | Troca o apelido |
| `meus amigos` | Lista amigos e convites |
| `remover amigo Carlos` | Pede confirmação; bloqueia novas operações, mantém histórico e pendências |

Amigos só são reconhecidos perto de verbos financeiros (dividir, cobrar, dever, pagar, receber): "almocei com Carlos" não gera cobrança. Amigos veem apenas as operações em que participam; carteira compartilhada é outra permissão (não ativada).

## ➗ Divisões

Prioridade de interpretação: **1)** valor devido explícito, **2)** percentual ou fração, **3)** divisão igual. Quem pagou absorve o arredondamento; nada passa de 2 casas decimais.

| Mensagem | Resultado |
|---|---|
| `dividir 150 com Carlos` | Total R$ 150, R$ 75 cada |
| `a conta deu 300 e Carlos me deve 150` | Carlos deve R$ 150 |
| `a conta deu 300 e Carlos deve metade` | Carlos deve R$ 150 |
| `dividir 180 com Carlos e Ana` | Três participantes, R$ 60 cada |
| `dividir 180 somente entre Carlos e Ana` | Quem pagou não participa (R$ 90 cada) |
| `dividir 200 com Carlos e Ana, Carlos 50 e Ana 80` | Valores explícitos por pessoa |
| `dividir 150 no Nubank com Carlos` | Pula perguntas, mas mostra a prévia |
| `cobrar 80 do Carlos pelo almoço` | Cobrança direta, sem gasto para quem cobra |

Toda divisão mostra prévia com total, participantes, parte de cada um, valores a cobrar, meio de pagamento, cartão/ciclo e o lançamento líquido de quem pagou — e só grava após `sim`, numa única atualização multipath. Mensagens com tag (`cobrar 80 de 123456`) continuam no fluxo antigo.

Parcelado no cartão (`dividir 1200 em 3x no Nubank com Carlos`): o bot pergunta se o acerto é **por parcela** (padrão, uma cobrança por fatura) ou **pelo total**.

## 💳 Cartões

Guardamos apenas apelido, dia estimado de fechamento, dia de vencimento e o indicador de padrão. Número, validade e CVV são recusados.

| Mensagem | O que faz |
|---|---|
| `adicionar cartão Nubank fecha dia 3 vence dia 10` | Cadastra (sem fechamento, estima 7 dias antes do vencimento) |
| `meus cartões` · `cartão padrão Inter` · `remover cartão Inter` | Gerencia |
| `minha fatura Nubank fechou hoje` | Corrige o ciclo e libera as cobranças da fatura |
| `Nubank vence dia 15` | Ajusta o vencimento |

Compras no dia do fechamento ou depois entram na fatura seguinte. Sem integração bancária, o fechamento é sempre uma estimativa.

## 🧾 Cobranças e pagamentos

Estados: aguardando aceite, aceita, aguardando fechamento, disponível para pagamento, pagamento parcial, pagamento informado, paga, recusada, contestada e cancelada. O campo antigo `status` continua sincronizado (compatível com cobranças existentes e com o site).

Ligada a cartão, a cobrança aparece na hora como **aguardando fechamento**; no fechamento estimado vai para "a receber"/"a pagar", os dois são avisados e vale o vencimento do cartão de quem pagou.

| Mensagem | Quem | O que faz |
|---|---|---|
| `cobranças` · `a receber` · `a pagar` · `cobranças com Carlos` | ambos | Lista numerada |
| `paguei` · `paguei cobrança 2` · `paguei R$ 40` · `paguei 40 pro Carlos` | devedor | Informa pagamento (valor sem número da cobrança pede confirmação) |
| `recebi cobrança 2` · `recebi` | credor | Confirma e encerra (ou registra parcial) |
| `recebi do Carlos` · `Carlos me pagou 50` | credor | Recebimento espontâneo, com confirmação |
| `não recebi cobrança 2` | credor | Volta ao estado anterior |
| `aceitar cobrança 2` · `recusar cobrança 2 motivo ...` | devedor | Responde |
| `contestar cobrança 2 valor 50 motivo ...` | devedor | Sugestão; nada muda sozinho |
| `aprovar sugestão 2` · `manter cobrança 2` · `cancelar cobrança 2` | credor | Reenvia/mantém/cancela (com confirmação) |
| `cobrar novamente Carlos` | credor | 1 lembrete por cobrança a cada 24 h |
| `silenciar lembretes` · `reativar lembretes` | devedor | Controla lembretes |
| `balanço` | ambos | Gasto líquido, a receber, a pagar, aguardando confirmação, parciais e compartilhados |

Pagamentos parciais preservam valor original, total pago e saldo. Lembretes automáticos (flag `FEATURE_PROACTIVE_MESSAGES`) saem no fechamento estimado e no vencimento, entre 9h e 21h, e param após o pagamento confirmado; depois do vencimento, só lembretes manuais. Reembolsos e partes de amigos não inflam o gasto pessoal líquido.

## 📈 Consultoria e investimentos

Onboarding progressivo: o bot pergunta só o dado necessário para a função pedida.

| Mensagem | O que faz |
|---|---|
| `orientação financeira` | Plano na ordem: essenciais → dívidas caras → reserva → metas curtas → investimentos |
| `renda variável média 5000 mínimo 3500` | Usa a faixa conservadora (mínimo ou 80% da média) |
| `despesas essenciais 2200` · `tenho reserva de 5000` · `reserva de 8 meses` | Perfil |
| `dívida cartão 2000 juros 12% ao mês` · `quitei a dívida cartão` · `não tenho dívidas` | Dívidas |
| `sou moderado` · `tenho 30 anos` · `objetivo viagem 6000 em 12 meses` · `liquidez alta` | Perfil de investidor |
| `meu perfil financeiro` | Perfil completo |
| `pesquisar investimentos` | Pesquisa com fontes (só quando pedida) |

Regras: reserva padrão de 6 meses de essenciais (3 a 12); 50/30/20 só como referência, com percentuais calculados pela situação real; dívida cara (cartão, cheque especial ou juros ≥ 2% a.m.) tem prioridade; o perfil de investidor pede revisão a cada 6 meses ou após mudança importante.

Pesquisa: exige idade, perfil de risco, objetivo, prazo, liquidez, reserva e dívidas. Menores recebem só educação financeira. Até 3 opções (renda fixa, Tesouro, CDB, fundos, ETFs, ações; cripto só quando compatível), comparando compatibilidade, risco, liquidez, prazo, custos/impostos, indicador, data e links. Sem alavancagem ou derivativos. Consultas à Brave são genéricas (sem dados pessoais); fontes oficiais primeiro (BCB, CVM, Tesouro Direto, B3); conclusões exigem duas fontes independentes e divergências são mostradas. Conteúdo web é tratado como não confiável (tentativas de prompt injection são descartadas). Se a pesquisa falhar, a resposta traz o aviso **SEM VERIFICAÇÃO AO VIVO** e nenhuma taxa, preço ou ranking. No Firebase ficam só consultas genéricas, URLs citadas, data e modo.

## 🚩 Feature flags e rollback

| Variável | Subsistema |
|---|---|
| `FEATURE_CONVERSATIONAL_AI` | IA conversacional (DeepSeek + consentimento) |
| `FEATURE_PERSONALITIES` | Personalidades |
| `FEATURE_FRIENDS` | Amigos |
| `FEATURE_SPLITS` | Divisões e cobranças (requer amigos) |
| `FEATURE_CARDS` | Cartões e faturas |
| `FEATURE_FINANCIAL_ADVISOR` | Consultoria financeira |
| `FEATURE_INVESTMENT_RESEARCH` | Pesquisa de investimentos |
| `FEATURE_PROACTIVE_MESSAGES` | Lembretes automáticos (requer divisões) |

Em produção cada flag só liga com o valor `true`. Em `NODE_ENV=development`, flags sem valor ficam ligadas.

**Rollback:** defina a flag do subsistema com problema como `false` no Railway e reinicie o serviço. Os dados gravados continuam no Firebase (as mudanças são aditivas) e voltam a ser usados quando a flag for religada. Com todas as flags desligadas o bot se comporta como a versão anterior; cobranças criadas no fluxo novo continuam aparecendo e respondendo pelos comandos antigos (`cobranças recebidas`, `aceitar cobrança 1`). Para parar só o consumo de IA sem desligar recursos, reduza `AI_MONTHLY_BUDGET_BRL` ou remova `DEEPSEEK_API_KEY`/`BRAVE_API_KEY`.

## 🗃️ Dados e migração

Mudanças só aditivas, sob `grupos/SALVAMONEY/usuarios/{tag}`: `amigos`, `cartoes`, `divisoes`, `privacidade`, `preferencias/personalidade`, `preferencias/lembretes`, `pesquisas`, `idempotencia` (hashes) e `migracoes`. Cobranças novas usam os caminhos existentes (`cobrancasEnviadas`/`cobrancasRecebidas`) com campos extras (`estado`, `valorOriginal`, `valorPago`, `pagamentos`, `fechamentoPrevisto`, `vencimento`...). O perfil financeiro ganha campos opcionais. Controle de custos em `sistema/custosIA`.

Migrações idempotentes (rodam na primeira mensagem do usuário com `FEATURE_CARDS` ou `FEATURE_SPLITS`, marcadas em `migracoes/{id}`):

- `2026_09_cartao_legado`: o antigo `perfilFinanceiro.vencimentoCartao` vira o cartão "Cartão principal" (se não houver cartões).
- `2026_09_cobrancas_estado`: cobranças antigas ganham `estado`, `valorOriginal` e `valorPago` derivados do `status`, nas duas cópias quando existirem. Registros incompletos são mantidos como estão.

Nada é apagado ou renomeado; tags, sessões, usuários, gastos, cobranças, parcelas, metas, alertas, preferências e relatórios existentes continuam iguais.

## ⚠️ Limitações

- Sem integração bancária: fechamento de fatura é estimado e pagamentos dependem da confirmação de quem recebe.
- O custo de imagem é estimado por requisição; tokens das chamadas antigas ao Groq são estimados pelo tamanho do texto.
- Com a IA conversacional ligada, as chamadas antigas ao Groq (resumo, dicas, classificador de categoria) também exigem o consentimento do usuário e recebem conteúdo sanitizado.
- O contexto da IA fica em memória: reiniciar o processo limpa a conversa (dados financeiros não se perdem).
- Pesquisa depende da disponibilidade da Brave e das fontes; sem tarifa configurada ela fica em modo "sem verificação ao vivo".
- Orientações são educativas e não substituem consultoria profissional personalizada.

---

## Segurança recomendada

Configure `WEBHOOK_TOKEN` para recusar chamadas ao webhook sem token. O token pode ser enviado por `Authorization: Bearer ...`, pelo header `x-webhook-token` ou pela query `?webhook_token=...`, conforme o provedor permitir.

Configure `DASHBOARD_TOKEN` para proteger `/api/dashboard` e `/api/gasto/:id`. Com ele ativo, abra o dashboard com `?token=SEU_TOKEN` para que a interface repasse o token nas chamadas da API.

Use `NODE_ENV=production` no Railway. Sem `NODE_ENV`, o backend também assume o modo seguro: webhook e API do dashboard recusam chamadas enquanto os tokens não estiverem configurados. Para desenvolvimento local sem tokens, declare explicitamente `NODE_ENV=development`.

Por padrão, logs escondem telefone, mensagens e transcrições. Use `LOG_SENSITIVE_DATA=true` somente em diagnóstico controlado.

### Firebase Realtime Database

As regras do Realtime Database devem bloquear leitura e escrita direta do público. O frontend não deve acessar o Firebase diretamente; toda consulta ou alteração de dados precisa passar pelo backend.

O backend usa `firebase-admin`, que autentica com credenciais de service account e ignora as Security Rules do Realtime Database. Por isso, rules fechadas protegem contra acesso público direto sem impedir o bot, webhook ou dashboard backend de ler e gravar dados.

As rules ficam em `database.rules.json`:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

Para aplicar manualmente, após revisar o projeto/ambiente:

```bash
firebase database:rules:set database.rules.json --project SEU_PROJECT_ID
```

---

## Estrutura do código

`server.js` fica como ponto de entrada do Express: carrega a configuração, monta os serviços e registra as rotas públicas.

| Arquivo | Responsabilidade |
|---|---|
| `src/config.js` | Variáveis de ambiente atuais, defaults e validação |
| `src/firebase-db.js` | Inicialização do Firebase Realtime Database |
| `src/routes.js` | Webhook, dashboard, home e health nas rotas existentes |
| `src/bot-service.js` | Orquestra os comandos recebidos pelo bot |
| `src/bot/account-service.js` | Criação de código, entrada e troca de conta |
| `src/bot/ai-media-service.js` | IA de texto, transcrição de áudio e leitura de imagem |
| `src/bot/commands.js` | Detectores de comandos e extração do nome ao criar código |
| `src/bot/categories.js` | Regras de categoria usadas em texto, imagem e IA |
| `src/bot/date-utils.js` | Datas do bot, chave mensal do Firebase e nomes dos meses |
| `src/bot/expense-service.js` | Resumos, lançamento, parcelamento e exclusão de gastos |
| `src/bot/text-utils.js` | Normalização de texto e limpeza de chaves |
| `src/providers/whatsapp.js` | Envio por Evolution API |
| `src/providers/groq.js` | Chat, transcrição, leitura de imagem e download de mídia |
| `src/webhook-parser.js` | Leitura dos payloads recebidos no webhook |
| `src/session-store.js` | Sessões do WhatsApp com cache e Firebase |
| `src/message-dedupe.js` | Bloqueio em memória de mensagens repetidas |
| `src/security.js` | Leitura e comparação de tokens de webhook/dashboard |
| `src/safe-log.js` | Máscaras para logs de telefone, texto e mídia |
| `src/dashboard-page.js` | HTML atual do dashboard |
| `src/expense-parser.js` | Parser de valor, gasto simples e parcelamento |
| `src/ai/ai-gateway.js` | DeepSeek → GPT-OSS com timeout, retry único, circuit breaker, orçamento e consentimento |
| `src/ai/privacy.js` | Redação e sanitização de tudo que sai para provedores externos |
| `src/ai/cost-tracker.js` | Orçamento mensal, tarifas configuráveis e alertas ao administrador |
| `src/ai/request-context.js` | Contexto por mensagem (consentimento, `messageId`) |
| `src/services/idempotency-store.js` | Chaves idempotentes (hash) para ações mutáveis |
| `src/services/migration-service.js` | Migrações aditivas e idempotentes por usuário |
| `src/bot/assistant-service.js` | Orquestra os recursos novos e as prévias pendentes |
| `src/bot/split-parser.js` · `split-service.js` | Interpretação, prévia e gravação de divisões |
| `src/bot/obligation-service.js` · `charge-state.js` | Máquina de estados de cobranças, pagamentos e lembretes |
| `src/bot/friend-service.js` · `card-service.js` | Amigos/apelidos e cartões/ciclos |
| `src/bot/advisor-service.js` · `financial-planner.js` | Perfil ampliado e plano determinístico |
| `src/bot/investment-research-service.js` · `src/research/*` | Pesquisa com Brave, política de fontes e catálogo |
| `src/bot/proactive-scheduler.js` | Lembretes de fechamento e vencimento |

---

## Verificação local

```bash
npm run check
npm test
```

---

## 📂 Estrutura Firebase criada pelo bot

```
bot_sessions/
  {phone}/
    user: "João"
    group: "CASA2024"

grupos/{group}/usuarios/{user}/gastos/{ano_mes}/
  {id}/
    desc: "almoço"
    value: 50
    cat: "Alimentação"
    date: "2026-05-14"
    user: "João"
    viaBot: true
```

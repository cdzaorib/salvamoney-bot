# 💰 SalvaMoney Bot — WhatsApp

Bot que registra gastos via WhatsApp e salva direto no Firebase.

## Recursos

- Registro de gastos por texto, áudio e imagem
- Parcelamento com lançamentos nos meses seguintes
- Resumo mensal, resumo do dia e listagem dos últimos gastos
- Dashboard simples para consultar e apagar gastos
- Suporte a Z-API e Evolution API

## 🚀 Deploy no Railway (grátis)

### 1. Crie conta no Railway
Acesse: https://railway.app e entre com GitHub.

### 2. Suba os arquivos
- Crie um repositório no GitHub com esses arquivos
- No Railway: New Project → Deploy from GitHub Repo

### 3. Configure as variáveis de ambiente
No Railway, vá em **Variables** e adicione cada linha do `.env`.

Use `.env.example` como base. Mantenha tokens reais fora do repositório.

### 4. Pegue a URL do servidor
O Railway vai gerar uma URL tipo:
`https://salvamoney-bot-production.up.railway.app`

### 5. Configure o Webhook no Z-API
No painel do Z-API:
- Vá em **Webhooks**
- Cole a URL: `https://SUA-URL.railway.app/webhook`
- Ative os eventos: **ReceivedCallback**

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
| `ajuda` | Mostra todos os comandos |

---

## Segurança recomendada

Configure `WEBHOOK_TOKEN` para recusar chamadas ao webhook sem token. O token pode ser enviado por `Authorization: Bearer ...`, pelo header `x-webhook-token` ou pela query `?webhook_token=...`, conforme o provedor permitir.

Configure `DASHBOARD_TOKEN` para proteger `/api/dashboard` e `/api/gasto/:id`. Com ele ativo, abra o dashboard com `?token=SEU_TOKEN` para que a interface repasse o token nas chamadas da API.

Por padrão, logs escondem telefone, mensagens e transcrições. Use `LOG_SENSITIVE_DATA=true` somente em diagnóstico controlado.

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

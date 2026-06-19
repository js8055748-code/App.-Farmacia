# SECURITY RULES — SISTEMA DE FARMÁCIA

## Contexto

Sistema de farmácia municipal que armazena e processa dados sensíveis de saúde (PHI) protegidos pela **LGPD**.  
Qualquer vazamento de dados de pacientes (CPF, telefone, histórico de medicamentos) configura infração legal.  
Todas as regras abaixo são **obrigatórias** e se sobrepõem ao comportamento padrão do Express.

---

## Regras de Autenticação

- Todas as rotas de negócio devem passar pelo middleware `src/http/middleware/authenticate.js`.
- O middleware injeta `req.user` com os dados da sessão autenticada.
- Rotas públicas permitidas sem token: `POST /api/login`, `POST /api/usuarios`, arquivos estáticos de `public/`.
- O token de sessão deve ser gerado com `crypto.randomUUID()` — nunca com Math.random ou timestamp.
- Sessões expiram em no máximo **8 horas** (`SESSION_TTL_MS = 8 * 60 * 60 * 1000`).
- Nunca repetir a lógica de validação de token dentro de controllers ou use cases — apenas no middleware.

---

## Regras de Senha

- Senhas armazenadas com **bcrypt**, custo mínimo **12**.
- Proibido usar SHA-256, MD5 ou qualquer hash sem salt para armazenar senhas.
- A senha padrão gerada no cadastro **não pode** ser derivada de dados conhecidos (CPF, data de nascimento).
- Gerar senha inicial aleatória: `crypto.randomBytes(8).toString('hex')`.
- Toda lógica de hash vive exclusivamente em `src/domain/user/passwordUtils.js`.

```js
const bcrypt = require('bcryptjs');
const BCRYPT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
```

---

## Regras de Sessão

- Tokens de sessão armazenados em cookie `HttpOnly; SameSite=Strict; Secure` (em produção).
- Proibido usar `localStorage` ou `sessionStorage` para armazenar tokens de sessão.
- O servidor define o cookie no login; o cliente nunca manipula o token diretamente.

```js
res.cookie('session', token, {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_MS,
});
```

---

## Regras de Credenciais e Ambiente

- Proibido hardcodar qualquer credencial (senha de banco, token de API, chave secreta) no código-fonte.
- Todas as credenciais lidas exclusivamente via `process.env.*`.
- O arquivo `.env` nunca é commitado no git — deve estar no `.gitignore`.
- A pasta `dist/` nunca é commitada no git — deve estar no `.gitignore`.
- O banco de dados usa um usuário dedicado (não `root`) com permissões mínimas (apenas `SELECT`, `INSERT`, `UPDATE`, `DELETE` no schema `farmacia`).
- Conexões com banco remoto (Neon/Railway) usam `rejectUnauthorized: true`.

```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
```

---

## Regras de Output HTML (XSS)

- Proibido atribuir dados vindos da API diretamente a `innerHTML`, `outerHTML` ou `document.write`.
- Usar `textContent` para conteúdo textual simples.
- Usar `document.createElement` + `appendChild` para construção de elementos dinâmicos.
- Quando innerHTML for inevitável, chamar `escapeHtml` de `src/shared/sanitize.js` antes.

```js
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

```js
// PROIBIDO
row.innerHTML = `<td>${m.nome}</td>`;

// CORRETO
const td = document.createElement('td');
td.textContent = m.nome;
row.appendChild(td);
```

---

## Regras de Controle de Acesso a Dados (IDOR)

- Endpoints que retornam dados de um paciente específico devem verificar se `req.user` tem permissão.
- IDs numéricos sequenciais não são segredos — a autenticação é a única proteção.
- `GET /api/dispensacoes/paciente/:id` e `GET /api/pacientes/cpf/:cpf` são rotas protegidas obrigatoriamente.
- Nunca expor IDs internos do banco em respostas que não exijam isso.

---

## Regras de Exposição de Dados Sensíveis

- Proibido logar CPF, senha, token ou número de telefone em qualquer nível de log.
- Proibido incluir número de telefone pessoal hardcoded em arquivos HTML públicos.
- Dados de contato de administradores (WhatsApp, e-mail) devem vir de variáveis de ambiente ou configuração de banco.
- A rota `POST /api/login` não deve revelar se o e-mail existe ou não — retornar sempre `401 Unauthorized` com mensagem genérica.

---

## Regras de Configuração de Servidor

- O servidor Node.js nunca faz bind em `0.0.0.0` em produção sem um proxy reverso (nginx/Railway) na frente.
- Em produção, o cabeçalho `X-Powered-By: Express` deve ser removido: `app.disable('x-powered-by')`.
- Adicionar cabeçalhos de segurança via `helmet`:

```js
const helmet = require('helmet');
app.use(helmet());
```

---

## Checklist de Segurança — Validação por PR

Antes de qualquer merge, verificar:

| Item | Comando de verificação |
|---|---|
| Sem credenciais no código | `grep -r "password\s*[:=]\s*['\"][^'\"]\|token\s*[:=]\s*['\"][^'\"]" src/` |
| Sem innerHTML não sanitizado | `grep -r "innerHTML\s*=" public/` |
| Sem `rejectUnauthorized: false` | `grep -r "rejectUnauthorized" src/` |
| `.env` fora do git | `git ls-files .env` (deve retornar vazio) |
| `dist/` fora do git | `git ls-files dist/` (deve retornar vazio) |
| Todas as rotas protegidas têm middleware | `grep -r "router\.\(get\|post\|put\|delete\)" src/http/routes/` |

---

## Ordem de Correção por Prioridade

### Imediato (antes de qualquer deploy)

1. Revogar `WHATSAPP_TOKEN` no Meta Developer Console.
2. Adicionar `dist/` e `.env` ao `.gitignore`.
3. Remover `.env` do histórico: `git filter-branch` ou `BFG Repo-Cleaner`.
4. Criar usuário MySQL `farmacia_app` com senha forte — nunca usar `root`.
5. Mover todas as credenciais para variáveis de ambiente.

### Crítico (próxima sessão de desenvolvimento)

6. Criar `src/http/middleware/authenticate.js` e aplicar em todas as rotas protegidas.
7. Substituir `SHA-256(CPF)` por `bcrypt` em `src/domain/user/passwordUtils.js`.
8. Substituir `localStorage.setItem('farmaToken', ...)` por cookie `HttpOnly`.

### Alto (esta semana)

9. Substituir todos os `innerHTML` por `textContent` / `createElement` nos arquivos de `public/`.
10. Ativar `rejectUnauthorized: true` em `src/db.js`.
11. Adicionar `helmet` e remover `X-Powered-By`.

### Normal (refatoração estrutural)

12. Seguir a sequência completa de `roules/execution-prompts.md` com as correções acima integradas.

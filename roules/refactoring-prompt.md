# PROMPT DE REFATORAÇÃO — SISTEMA DE FARMÁCIA

## Contexto do Sistema

Sistema de farmácia municipal (Divinópolis/MG) construído com **Node.js + Express + MySQL 8.4**.  
Responsabilidades: cadastro de pacientes, controle de estoque de medicamentos, dispensação com controle de transações, lembretes via WhatsApp (cron), autenticação de usuários por sessão em memória e integração com PDF REMUME.

**Stack atual:** Node.js · Express · mysql2 · node-cron · pdf-text-reader · dotenv

---

## Problemas Identificados no Código Atual

1. **God File** — `src/server.js` tem 828 linhas misturando setup do Express, pool MySQL, DDL, lógica de negócio, rotas, cron e bootstrap do servidor em um único arquivo.
2. **Callback hell** — 5+ níveis de aninhamento dentro de `POST /api/dispensar`.
3. **Violação SRP** — cada rota faz validação, lógica de negócio e acesso ao banco diretamente no handler.
4. **SQL espalhado** — queries hardcoded nos controllers sem nenhuma camada de abstração.
5. **Sem separação de camadas** — nenhuma fronteira entre HTTP, domínio e persistência.
6. **Sessões em Map sem middleware** — token validado manualmente em cada rota que precisar.
7. **Comentários desnecessários** — blocos decorativos (`// ======`) e comentários que descrevem o óbvio.
8. **Logs de debug em produção** — `console.log('REQ BODY /api/dispensar:', req.body)`.
9. **DDL no startup** — criação de tabela executada inline no bootstrap do servidor.
10. **Formatação de data duplicada** — `converterData` e `formatarDataBR` definidas dentro dos handlers.

---

## Arquitetura Alvo

```
src/
├── config/
│   └── database.js
├── domain/
│   ├── patient/
│   │   ├── Patient.js
│   │   └── PatientRepository.js
│   ├── medicine/
│   │   ├── Medicine.js
│   │   └── MedicineRepository.js
│   ├── dispensation/
│   │   ├── Dispensation.js
│   │   └── DispensationRepository.js
│   └── user/
│       ├── User.js
│       ├── UserRepository.js
│       ├── SessionStore.js
│       └── passwordUtils.js
├── infrastructure/
│   ├── db/
│   │   ├── PatientMysqlRepository.js
│   │   ├── MedicineMysqlRepository.js
│   │   ├── DispensationMysqlRepository.js
│   │   └── UserMysqlRepository.js
│   ├── whatsapp/
│   │   ├── WhatsappService.js
│   │   └── messages.js
│   └── pdf/
│       └── RemumeLoader.js
├── application/
│   ├── patient/
│   │   ├── RegisterPatient.js
│   │   └── FindPatientByCpf.js
│   ├── medicine/
│   │   ├── ListMedicines.js
│   │   ├── RegisterMedicine.js
│   │   ├── UpdateMedicine.js
│   │   └── AddStock.js
│   ├── dispensation/
│   │   ├── RegisterDispensation.js
│   │   └── GetDispensationHistory.js
│   └── user/
│       ├── RegisterUser.js
│       └── AuthenticateUser.js
├── http/
│   ├── middleware/
│   │   ├── authenticate.js
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── patientsRouter.js
│   │   ├── medicinesRouter.js
│   │   ├── dispensationsRouter.js
│   │   ├── usersRouter.js
│   │   └── remumeRouter.js
│   └── controllers/
│       ├── PatientController.js
│       ├── MedicineController.js
│       ├── DispensationController.js
│       └── UserController.js
├── scheduler/
│   └── remindersCron.js
├── shared/
│   ├── dateUtils.js
│   └── errors.js
└── server.js
```

---

## Regras Obrigatórias de Refatoração

### Arquitetura
- Aplicar **Arquitetura Hexagonal** (Ports & Adapters): o domínio não pode depender de Express, mysql2 ou qualquer lib de infraestrutura.
- Direção de dependência entre camadas: `HTTP → Application → Domain ← Infrastructure`.
- Repositórios definidos como **interfaces** no domínio; implementações concretas em `infrastructure/db/`.
- Use Cases em `application/` recebem repositórios por **injeção de dependência** no construtor.

### SOLID
- **SRP**: um único motivo de mudança por arquivo. Controller trata só HTTP. Use Case orquestra só o domínio. Repository faz só persistência.
- **OCP**: novos comportamentos são adicionados criando novos use cases, sem modificar os existentes.
- **LSP**: todas as implementações de repositório são intercambiáveis com sua interface.
- **ISP**: interfaces de repositório expõem apenas os métodos que seus consumidores realmente usam.
- **DIP**: controllers e use cases dependem de abstrações, nunca de implementações concretas.

### Nomenclatura
- Todos os **nomes de arquivos, pastas, classes, funções e variáveis** em **inglês**.
- Classes: `PascalCase` — `RegisterDispensation`, `PatientController`.
- Funções e variáveis: `camelCase` — `findByCpf`, `reduceStockBatch`, `pickupDate`.
- Constantes: `UPPER_SNAKE_CASE` — `SESSION_TTL_MS`, `REMUME_MAX_RESULTS`.
- Sem abreviações, exceto as universalmente conhecidas (`id`, `url`, `cpf`, `http`).

### Clean Code
- **Zero comentários** no código. Nomes bem escolhidos são a documentação.
- Funções com no máximo **20 linhas**. Extraia se ultrapassar.
- Arquivos com no máximo **200 linhas**. Divida se ultrapassar.
- Sem `console.log` de debug. Apenas logs estruturados de erro quando necessário.
- Sem magic strings ou magic numbers — extraia para constantes nomeadas.

### DRY
- Funções utilitárias de data (`formatDateBR`, `toSqlDate`) somente em `src/shared/dateUtils.js`.
- Lógica de hash de senha somente em `src/domain/user/passwordUtils.js`.
- Templates de mensagem WhatsApp somente em `src/infrastructure/whatsapp/messages.js`.

### Async/Await
- Converter **todos** os callbacks para `async/await` usando `mysql2/promise`.
- Transações usam `await conn.beginTransaction()` / `await conn.commit()` / `await conn.rollback()` em bloco `try/catch/finally`.
- `conn.release()` sempre no `finally`.

### Autenticação
- Middleware `authenticate.js` valida o token e injeta `req.user` — rotas protegidas não repetem essa lógica.
- Sessões continuam em `Map` (sem mudar a estratégia), mas encapsuladas em `src/domain/user/SessionStore.js`.

### Tratamento de Erros
- Use Cases lançam erros de domínio tipados (`ValidationError`, `NotFoundError`, `ConflictError`) definidos em `src/shared/errors.js`.
- Um único middleware `errorHandler.js` converte erros de domínio em status HTTP.
- Nunca engolir erros silenciosamente.

---

## Contrato de Entrega

Para cada arquivo gerado, garantir:

| Critério | Exigência |
|---|---|
| Linhas por arquivo | ≤ 200 |
| Comentários | Zero |
| `console.log` de debug | Zero |
| Callbacks aninhados | Zero |
| SQL fora de repositório | Zero |
| Lógica de negócio no controller | Zero |
| Imports de infra no domínio | Zero |
| Identificadores em português | Zero |

---

## Ordem de Execução

Execute nesta sequência para não quebrar o sistema em execução:

1. `src/config/database.js` — extrair pool como módulo usando `mysql2/promise`
2. `src/shared/dateUtils.js` — extrair utilitários de data
3. `src/shared/errors.js` — definir classes de erro de domínio
4. `src/domain/**` — definir entidades e interfaces de repositório
5. `src/domain/user/passwordUtils.js` e `src/domain/user/SessionStore.js`
6. `src/infrastructure/db/**` — implementar repositórios MySQL com async/await
7. `src/infrastructure/whatsapp/**` — isolar serviço e templates de mensagem
8. `src/application/**` — implementar use cases com repositórios injetados
9. `src/http/middleware/**` — autenticação e error handler
10. `src/http/controllers/**` — controllers finos (somente HTTP)
11. `src/http/routes/**` — routers Express
12. `src/scheduler/remindersCron.js` — cron isolado, sem lógica de negócio inline
13. `src/server.js` — bootstrap com no máximo 30 linhas

---

## Padrão de Código Esperado

### Erros de domínio (`src/shared/errors.js`)
```js
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

module.exports = { ValidationError, NotFoundError, ConflictError };
```

### Use Case (camada application)
```js
const { ValidationError } = require('../../shared/errors');

class RegisterDispensation {
  constructor(dispensationRepository, medicineRepository, whatsappService) {
    this.dispensationRepository = dispensationRepository;
    this.medicineRepository = medicineRepository;
    this.whatsappService = whatsappService;
  }

  async execute(data) {
    if (!data.patientId || !data.medicines?.length) {
      throw new ValidationError('Paciente e medicamentos são obrigatórios.');
    }
    const dispensationId = await this.dispensationRepository.create(data);
    await this.medicineRepository.reduceStockBatch(data.medicines);
    await this.whatsappService.sendConfirmation(data.phone, data);
    return dispensationId;
  }
}

module.exports = RegisterDispensation;
```

### Controller (camada HTTP)
```js
class DispensationController {
  constructor(registerDispensation, getDispensationHistory) {
    this.registerDispensation = registerDispensation;
    this.getDispensationHistory = getDispensationHistory;
  }

  async dispense(req, res, next) {
    try {
      const id = await this.registerDispensation.execute(req.body);
      res.status(201).json({ ok: true, dispensationId: id });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = DispensationController;
```

### Repository MySQL (camada infrastructure)
```js
const { toSqlDate } = require('../../shared/dateUtils');

class DispensationMysqlRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(data) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(SQL_INSERT_DISPENSATION, [
        data.patientId,
        toSqlDate(data.pickupDate),
        toSqlDate(data.renewalDate),
        data.notes ?? null,
      ]);
      await conn.commit();
      return result.insertId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = DispensationMysqlRepository;
```

### Middleware de erros
```js
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode ?? 500;
  res.status(statusCode).json({ error: err.message });
}

module.exports = errorHandler;
```

---

## Restrições

- **Não alterar** o schema do banco (tabelas e colunas existentes devem ser preservadas).
- **Não alterar** o contrato público das rotas HTTP (URLs e formato de request/response devem permanecer idênticos).
- **Não adicionar** dependências externas além das já existentes no `package.json`.
- **Não criar** arquivos de documentação (`.md`) além dos já existentes em `roules/`.
- **Não escrever** testes nesta fase (refatoração estrutural primeiro).
- Manter compatibilidade total com o frontend existente em `public/`.

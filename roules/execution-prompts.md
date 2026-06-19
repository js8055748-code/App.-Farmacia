# PROMPTS DE EXECUÇÃO — REFATORAÇÃO DO SISTEMA DE FARMÁCIA

Execute um passo por vez. Aguarde a confirmação do Claude antes de avançar.

---

## PASSO 1 — Pool de Banco de Dados

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie o arquivo src/config/database.js.
- Extraia o pool MySQL de src/server.js para este módulo
- Use mysql2/promise (não mysql2 com callbacks)
- Exporte o pool como singleton
- O arquivo deve ter menos de 200 linhas, zero comentários e zero console.log de debug

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 2 — Utilitários de Data

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie o arquivo src/shared/dateUtils.js.
- Extraia de src/server.js as funções de formatação e conversão de data
- Exporte as funções formatDateBR e toSqlDate
- O arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 3 — Classes de Erro de Domínio

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie o arquivo src/shared/errors.js.
- Crie as classes ValidationError, NotFoundError e ConflictError
- Cada classe deve herdar de Error e ter a propriedade statusCode
- Exporte as três classes no mesmo arquivo
- O arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 4 — Entidades e Interfaces de Repositório

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie as entidades e interfaces de repositório dentro de src/domain/ conforme a arquitetura alvo do prompt de refatoração.
- src/domain/patient/Patient.js
- src/domain/patient/PatientRepository.js
- src/domain/medicine/Medicine.js
- src/domain/medicine/MedicineRepository.js
- src/domain/dispensation/Dispensation.js
- src/domain/dispensation/DispensationRepository.js
- src/domain/user/User.js
- src/domain/user/UserRepository.js

As interfaces declaram apenas os métodos que serão usados pelos use cases, sem implementação.
Cada arquivo deve ter menos de 200 linhas, zero comentários, nomes em inglês.

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 5 — Utilitários de Usuário

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie os dois arquivos abaixo:

1. src/domain/user/passwordUtils.js
   - Extraia de src/server.js toda a lógica de hash SHA-256 de senha
   - Exporte as funções hashPassword e verifyPassword

2. src/domain/user/SessionStore.js
   - Extraia de src/server.js o Map de sessões e o intervalo de limpeza
   - Exporte uma classe SessionStore com os métodos create, find e remove

Cada arquivo deve ter menos de 200 linhas, zero comentários, nomes em inglês.

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 6 — Repositórios MySQL

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie as implementações concretas dos repositórios em src/infrastructure/db/:
- src/infrastructure/db/PatientMysqlRepository.js
- src/infrastructure/db/MedicineMysqlRepository.js
- src/infrastructure/db/DispensationMysqlRepository.js
- src/infrastructure/db/UserMysqlRepository.js

Regras obrigatórias:
- Receber o pool via construtor (injeção de dependência)
- Usar async/await com mysql2/promise, sem callbacks
- Transações em try/catch/finally com conn.release() no finally
- Todo SQL deve ficar dentro destes arquivos, em constantes nomeadas no topo
- Implementar exatamente os métodos declarados nas interfaces do passo 4
- Cada arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 7 — Serviço WhatsApp

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie os dois arquivos abaixo:

1. src/infrastructure/whatsapp/messages.js
   - Extraia de src/server.js todos os templates de texto das mensagens WhatsApp
   - Exporte funções puras que recebem os dados e retornam a string da mensagem
   - Funções: buildConfirmationMessage, buildPickupReminderMessage, buildRenewalReminderMessage

2. src/infrastructure/whatsapp/WhatsappService.js
   - Envolva o módulo src/whatsapp.js existente
   - Exporte uma classe WhatsappService com os métodos sendConfirmation, sendPickupReminder e sendRenewalReminder
   - Use as funções de messages.js para montar os textos

Cada arquivo deve ter menos de 200 linhas, zero comentários, nomes em inglês.

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 8 — Use Cases

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie todos os use cases em src/application/ conforme a arquitetura alvo:
- src/application/patient/RegisterPatient.js
- src/application/patient/FindPatientByCpf.js
- src/application/medicine/ListMedicines.js
- src/application/medicine/RegisterMedicine.js
- src/application/medicine/UpdateMedicine.js
- src/application/medicine/AddStock.js
- src/application/dispensation/RegisterDispensation.js
- src/application/dispensation/GetDispensationHistory.js
- src/application/user/RegisterUser.js
- src/application/user/AuthenticateUser.js

Regras obrigatórias:
- Cada use case é uma classe com método execute(data)
- Receber todos os repositórios e serviços via construtor
- Lançar erros tipados de src/shared/errors.js para validações e not found
- Zero acesso direto ao banco, zero imports de mysql2 ou Express
- Cada arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 9 — Middlewares HTTP

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie os dois middlewares abaixo:

1. src/http/middleware/authenticate.js
   - Extraia de src/server.js a lógica de validação de token
   - Use SessionStore do passo 5
   - Injete req.user com os dados da sessão
   - Retorne 401 se o token for inválido ou expirado

2. src/http/middleware/errorHandler.js
   - Capture todos os erros lançados pelos use cases
   - Use a propriedade statusCode dos erros de src/shared/errors.js
   - Erros sem statusCode retornam 500
   - Zero console.log de debug

Cada arquivo deve ter menos de 200 linhas, zero comentários.

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 10 — Controllers

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie os controllers em src/http/controllers/:
- src/http/controllers/PatientController.js
- src/http/controllers/MedicineController.js
- src/http/controllers/DispensationController.js
- src/http/controllers/UserController.js

Regras obrigatórias:
- Cada controller é uma classe que recebe os use cases via construtor
- Métodos recebem (req, res, next) e chamam apenas next(err) para erros
- Zero lógica de negócio, zero SQL, zero acesso ao banco
- Cada método do controller deve ter no máximo 10 linhas
- Cada arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 11 — Routers

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie os routers Express em src/http/routes/:
- src/http/routes/patientsRouter.js
- src/http/routes/medicinesRouter.js
- src/http/routes/dispensationsRouter.js
- src/http/routes/usersRouter.js
- src/http/routes/remumeRouter.js

Regras obrigatórias:
- Cada router instancia seus próprios repositórios, use cases e controller (composição manual, sem framework de DI)
- Use o pool de src/config/database.js
- Aplique o middleware authenticate.js nas rotas que exigem autenticação
- As URLs das rotas devem ser idênticas às de src/server.js atual
- Cada arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 12 — Cron de Lembretes

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Crie o arquivo src/scheduler/remindersCron.js.
- Extraia de src/server.js os dois agendamentos cron (retirada e renovação)
- Use os repositórios e WhatsappService do passo 6 e 7 via injeção de dependência
- Exporte uma função startRemindersScheduler(pool) que inicializa os dois crons
- Zero lógica SQL inline — use métodos dos repositórios
- O arquivo deve ter menos de 200 linhas, zero comentários

Não mexa em nenhum outro arquivo ainda.
```

---

## PASSO 13 — Bootstrap Final

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Reescreva src/server.js como bootstrap puro:
- Importar e registrar todos os routers do passo 11
- Registrar o middleware errorHandler.js por último
- Chamar startRemindersScheduler do passo 12
- Chamar a função de carregamento do PDF REMUME
- Iniciar o servidor na porta configurada
- O arquivo deve ter no máximo 30 linhas, zero comentários, zero lógica de negócio

Após criar o arquivo, suba o servidor e confirme que está funcionando sem erros.
```

---

## VERIFICAÇÃO FINAL

```
Siga as regras de @CLAUDE.md e @roules/refactoring-prompt.md.

Faça uma verificação final da refatoração:
- Confirme que src/server.js tem no máximo 30 linhas
- Confirme que nenhum arquivo em src/ tem mais de 200 linhas
- Confirme que não existe nenhum callback aninhado em nenhum arquivo
- Confirme que não existe SQL fora dos arquivos em src/infrastructure/db/
- Confirme que nenhum arquivo em src/domain/ importa mysql2 ou Express
- Confirme que as rotas HTTP respondem igual ao comportamento anterior

Reporte qualquer violação encontrada.
```

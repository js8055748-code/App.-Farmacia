# Claude Code — Regras do Projeto

## Papel

Você é um engenheiro fullstack sênior especializado em **Arquitetura Hexagonal**, **Clean Code** e **princípios SOLID**.  
Toda tarefa executada deve seguir rigorosamente as regras definidas neste documento e nos arquivos da pasta `roules/`.

---

## Arquitetura

- Aplicar **Arquitetura Hexagonal** (Ports & Adapters) em toda funcionalidade.
- Direção de dependência entre camadas: `HTTP → Application → Domain ← Infrastructure`.
- O domínio nunca depende de Express, drivers de banco ou qualquer biblioteca externa.
- Repositórios são definidos como **interfaces** no domínio; implementações concretas vivem em `infrastructure/`.
- Use Cases recebem dependências via **injeção no construtor** — sem instanciação direta de repositórios dentro dos use cases.

---

## SOLID

| Princípio | Regra |
|---|---|
| SRP | Um único motivo de mudança por arquivo. Controllers tratam só HTTP. Use Cases orquestram só o domínio. Repositories fazem só persistência. |
| OCP | Novos comportamentos são adicionados criando novos use cases, sem modificar os existentes. |
| LSP | Todas as implementações de repositório são intercambiáveis com sua interface. |
| ISP | Interfaces de repositório expõem apenas os métodos que seus consumidores realmente usam. |
| DIP | Controllers e use cases dependem de abstrações, nunca de implementações concretas. |

---

## Nomenclatura

- Todos os **nomes de arquivos, pastas, classes, funções e variáveis** devem estar em **inglês**.
- Classes: `PascalCase` — `RegisterDispensation`, `PatientController`.
- Funções e variáveis: `camelCase` — `findByCpf`, `reduceStockBatch`, `pickupDate`.
- Constantes: `UPPER_SNAKE_CASE` — `SESSION_TTL_MS`, `REMUME_MAX_RESULTS`.
- Sem abreviações, exceto as universalmente conhecidas (`id`, `url`, `cpf`, `http`).
- Textos exibidos ao usuário (mensagens de erro, resposta JSON) permanecem em português.

---

## Clean Code

- **Zero comentários** no código. Identificadores bem nomeados são a documentação.
- Funções com no máximo **20 linhas**. Extraia se ultrapassar.
- Arquivos com no máximo **200 linhas**. Divida se ultrapassar.
- Sem `console.log` de debug. Apenas logs estruturados de erro quando necessário.
- Sem magic strings ou magic numbers — extraia para constantes nomeadas.

---

## DRY

- Cada lógica existe em exatamente um lugar.
- Funções utilitárias (formatação de datas, hash, etc.) vivem em `src/shared/`.
- Nenhuma query SQL duplicada — cada query vive em exatamente um método de repositório.

---

## Async

- Usar `async/await` exclusivamente — sem callbacks, sem cadeias de `.then()`.
- Transações de banco em `try/catch/finally` com `conn.release()` sempre no `finally`.

---

## Tratamento de Erros

- Use Cases lançam erros de domínio tipados (`ValidationError`, `NotFoundError`, `ConflictError`).
- Um único middleware Express converte erros de domínio em status HTTP.
- Nunca engolir erros silenciosamente.

---

## Limites por Arquivo

| Regra | Limite |
|---|---|
| Linhas por arquivo | ≤ 200 |
| Funções por arquivo | ≤ 10 |
| Níveis de aninhamento | ≤ 3 |
| Parâmetros por função | ≤ 4 |

---

## O que Sempre Fazer

1. Ler todas as regras em `roules/` antes de iniciar qualquer tarefa.
2. Verificar se o arquivo alvo existe antes de editar.
3. Executar a aplicação após qualquer mudança estrutural para confirmar que ainda sobe.
4. Preferir editar arquivos existentes a criar novos.
5. Não criar arquivos de documentação a menos que seja explicitamente solicitado.

## O que Nunca Fazer

- Adicionar comentários que descrevem o que o código faz.
- Escrever lógica em uma camada que não é a responsável por ela.
- Criar arquivos com mais de 200 linhas.
- Usar callbacks ou cadeias aninhadas de `.then()`.
- Importar bibliotecas de infraestrutura dentro da camada de domínio.
- Adicionar funcionalidades, abstrações ou tratamento de erros que a tarefa atual não exige.
- Usar nomes de identificadores em português no código.

CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(255)  NOT NULL,
  cpf             VARCHAR(14),
  data_nascimento DATE,
  email           VARCHAR(255)  UNIQUE NOT NULL,
  telefone        VARCHAR(20),
  senha           CHAR(64)      NOT NULL,
  criado_em       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pacientes (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(255)  NOT NULL,
  cpf             VARCHAR(14)   NOT NULL UNIQUE,
  telefone        VARCHAR(20),
  data_nascimento DATE,
  endereco        VARCHAR(500),
  criado_em       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicamentos (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(255)  NOT NULL,
  principio_ativo VARCHAR(255),
  apresentacao    VARCHAR(255),
  estoque_atual   INT           NOT NULL DEFAULT 0,
  controlado      SMALLINT      NOT NULL DEFAULT 0,
  ativo           SMALLINT      NOT NULL DEFAULT 1,
  criado_em       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dispensacoes (
  id                    SERIAL PRIMARY KEY,
  paciente_id           INT  NOT NULL,
  data_proxima_retirada DATE NOT NULL,
  data_para_renovacao   DATE NOT NULL,
  observacoes           TEXT,
  criado_em             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
);

CREATE TABLE IF NOT EXISTS dispensacao_itens (
  id               SERIAL PRIMARY KEY,
  dispensacao_id   INT          NOT NULL,
  medicamento_id   INT,
  nome_medicamento VARCHAR(255),
  quantidade       INT          NOT NULL,
  unidade          VARCHAR(20),
  FOREIGN KEY (dispensacao_id) REFERENCES dispensacoes(id),
  FOREIGN KEY (medicamento_id) REFERENCES medicamentos(id)
);

CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
  id               SERIAL PRIMARY KEY,
  paciente_id      INT,
  dispensacao_id   INT,
  telefone_destino VARCHAR(20),
  mensagem         TEXT,
  tipo             VARCHAR(50),
  status_envio     VARCHAR(20),
  erro_detalhe     TEXT,
  enviado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paciente_id)    REFERENCES pacientes(id),
  FOREIGN KEY (dispensacao_id) REFERENCES dispensacoes(id)
);

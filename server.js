require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2');
const { readPdfText } = require('pdf-text-reader');
const { enviarMensagemTexto } = require('./whatsapp');
const crypto = require('crypto');

const sessoes = new Map();

// === Lista REMUME carregada do PDF ===
let remumeList = [];

async function carregarRemumePDF() {
  const PDF_PATH = path.join(__dirname, 'pdf', 'Relaçao Municipal  de Medicamentos Essenciais- REMUME DIVINÓPOLIS- 2026.pdf');
  if (!fs.existsSync(PDF_PATH)) {
    console.warn('⚠️ PDF REMUME não encontrado em:', PDF_PATH);
    return;
  }
  try {
    console.log('📄 Carregando lista REMUME do PDF...');
    const text = await readPdfText({ url: PDF_PATH });
    const linhas = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    remumeList = linhas.map(linha => {
      const partes = linha.split(' ').filter(p => p.length > 0);
      const idxNum = partes.findIndex(p => /\d/.test(p));
      if (idxNum === -1) return { nome: linha, apresentacao: '' };
      return { nome: partes.slice(0, idxNum).join(' '), apresentacao: partes.slice(idxNum).join(' ') };
    }).filter(m => {
      if (m.nome.length < 3) return false;
      if (m.nome.split(' ').length > 5) return false; // cabeçalhos/texto descritivo têm muitas palavras
      if (!m.apresentacao && m.nome === m.nome.toUpperCase() && m.nome.split(' ').length > 2) return false; // seções em maiúsculas
      return true;
    });
    console.log(`✅ REMUME carregada: ${remumeList.length} medicamentos`);
  } catch (err) {
    console.error('❌ Erro ao carregar REMUME:', err.message);
  }
}

carregarRemumePDF();

const app = express();

// Middlewares
app.use((req, res, next) => {
  express.json()(req, res, (err) => {
    if (err) {
      console.error('Erro de parse JSON:', err.message, '| Body bruto recebido');
      return res.status(400).json({ erro: 'JSON inválido na requisição: ' + err.message });
    }
    next();
  });
});
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pool de conexões com MySQL (reconecta automaticamente)
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'farmacia',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Testa a conexão ao iniciar
db.getConnection((err, conn) => {
  if (err) {
    console.error('❌ Erro ao conectar no MySQL:', err.message);
    return;
  }
  console.log('✅ Conectado ao MySQL com sucesso!');
  conn.release();
});

db.query(`CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cpf VARCHAR(14),
  data_nascimento DATE,
  email VARCHAR(255) UNIQUE NOT NULL,
  telefone VARCHAR(20),
  senha CHAR(64) NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
  if (err) console.error('Erro ao criar tabela usuarios:', err.message);
  else console.log('✅ Tabela usuarios verificada.');
});

setInterval(() => {
  const agora = Date.now();
  for (const [token, s] of sessoes) {
    if (agora > s.expiraEm) sessoes.delete(token);
  }
}, 3600000);

// =======================
// POST /api/pacientes
// =======================
app.post('/api/pacientes', (req, res) => {
  console.log('REQ BODY /api/pacientes:', req.body);

  const { nome, cpf, data_nascimento, telefone, endereco } = req.body;

  if (!nome || !cpf) {
    return res.status(400).json({ erro: 'Nome e CPF são obrigatórios.' });
  }

  const sql = `
    INSERT INTO pacientes
      (nome, cpf, telefone, data_nascimento, endereco)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      nome.trim(),
      cpf.trim(),
      telefone ? telefone.trim() : null,
      data_nascimento || null,
      endereco || null,
    ],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ erro: 'CPF já cadastrado.' });
        }
        console.error('Erro ao salvar paciente:', err);
        return res.status(500).json({ erro: 'Erro ao salvar paciente.' });
      }

      res.status(201).json({
        ok: true,
        id: result.insertId,
      });
    }
  );
});

// ==============================
// GET /api/pacientes/cpf/:cpf
// ==============================
app.get('/api/pacientes/cpf/:cpf', (req, res) => {
  const cpf = req.params.cpf;

  if (!cpf) {
    return res.status(400).json({ erro: 'CPF é obrigatório.' });
  }

  const cpfLimpo = cpf.replace(/\D/g, '');

  const sql =
    'SELECT id, nome, cpf, telefone ' +
    'FROM pacientes ' +
    "WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = ? " +
    'LIMIT 1';

  db.query(sql, [cpfLimpo], (err, results) => {
    if (err) {
      console.error('Erro ao buscar paciente:', err);
      return res.status(500).json({ erro: 'Erro ao buscar paciente.' });
    }

    if (results.length === 0) {
      return res.json({ paciente: null });
    }

    const p = results[0];
    res.json({
      paciente: {
        id: p.id,
        nome: p.nome,
        cpf: p.cpf,
        telefone: p.telefone,
      },
    });
  });
});

// ==============================
// GET /api/medicamentos
// ==============================
app.get('/api/medicamentos', (req, res) => {
  const term = (req.query.term || '').trim();

  if (!term) {
    const sql =
      'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque ' +
      'FROM medicamentos WHERE ativo = 1 ORDER BY nome';

    db.query(sql, (err, results) => {
      if (err) {
        console.error('Erro ao listar medicamentos:', err);
        return res.status(500).json({ erro: 'Erro ao listar medicamentos.' });
      }

      return res.json({ medicamentos: results });
    });
    return;
  }

  const sqlBusca =
    'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque ' +
    'FROM medicamentos WHERE ativo = 1 AND nome LIKE ? ORDER BY nome LIMIT 20';

  db.query(sqlBusca, [`%${term}%`], (err, results) => {
    if (err) {
      console.error('Erro ao buscar medicamentos (autocomplete):', err);
      return res.status(500).json({ erro: 'Erro ao buscar medicamentos.' });
    }

    res.json(results);
  });
});

// ==============================
// POST /api/medicamentos
// ==============================
app.post('/api/medicamentos', (req, res) => {
  const { nome, principio_ativo, apresentacao, estoque, controlado } = req.body;

  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });

  const sql =
    'INSERT INTO medicamentos (nome, principio_ativo, apresentacao, estoque_atual, controlado) ' +
    'VALUES (?, ?, ?, ?, ?)';

  db.query(
    sql,
    [nome.trim(), principio_ativo || null, apresentacao || null, estoque || 0, controlado ? 1 : 0],
    (err, result) => {
      if (err) {
        console.error('Erro ao cadastrar medicamento:', err);
        return res.status(500).json({ erro: 'Erro ao cadastrar medicamento.' });
      }
      res.status(201).json({ ok: true, id: result.insertId });
    }
  );
});

// ==============================
// PUT /api/medicamentos/:id
// ==============================
app.put('/api/medicamentos/:id', (req, res) => {
  const id = req.params.id;
  const { nome, principio_ativo, apresentacao, estoque, controlado } = req.body;

  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });

  const sql =
    'UPDATE medicamentos SET nome=?, principio_ativo=?, apresentacao=?, estoque_atual=?, controlado=? WHERE id=?';

  db.query(
    sql,
    [nome.trim(), principio_ativo || null, apresentacao || null, estoque || 0, controlado ? 1 : 0, id],
    (err, result) => {
      if (err) {
        console.error('Erro ao atualizar medicamento:', err);
        return res.status(500).json({ erro: 'Erro ao atualizar medicamento.' });
      }
      if (result.affectedRows === 0) return res.status(404).json({ erro: 'Medicamento não encontrado.' });
      res.json({ ok: true });
    }
  );
});

// ==============================
// GET /api/remume?term=xxx
// ==============================
app.get('/api/remume', (req, res) => {
  const term = (req.query.term || '').toLowerCase().trim();
  if (!term || term.length < 2) return res.json([]);
  const resultados = remumeList
    .filter(m => m.nome.toLowerCase().includes(term))
    .slice(0, 20);
  res.json(resultados);
});

// ==============================
// POST /api/medicamentos/:id/adicionar-estoque
// ==============================
app.post('/api/medicamentos/:id/adicionar-estoque', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const qtd = parseInt(req.body.quantidade, 10);
  if (!id || isNaN(id)) return res.status(400).json({ erro: 'ID inválido.' });
  if (!qtd || qtd <= 0) return res.status(400).json({ erro: 'Quantidade inválida.' });
  db.query(
    'UPDATE medicamentos SET estoque_atual = estoque_atual + ? WHERE id = ?',
    [qtd, id],
    (err, result) => {
      if (err) {
        console.error('Erro ao adicionar estoque:', err);
        return res.status(500).json({ erro: 'Erro ao atualizar estoque.' });
      }
      if (result.affectedRows === 0) return res.status(404).json({ erro: 'Medicamento não encontrado.' });
      res.json({ ok: true });
    }
  );
});

// ==============================
//  POST /api/dispensar
// ==============================
app.post('/api/dispensar', (req, res) => {
  console.log('REQ BODY /api/dispensar:', req.body);
  const {
    paciente_id,
    nome_paciente,
    telefone,
    medicamentos,
    data_proxima_retirada, // "DD-MM-YYYY"
    data_para_renovacao,   // "DD-MM-YYYY"
    observacoes,
  } = req.body;

  console.log('VALIDACAO dispensar:', {
    paciente_id,
    data_proxima_retirada,
    data_para_renovacao,
    medicamentos_isArray: Array.isArray(medicamentos),
    medicamentos_length: Array.isArray(medicamentos) ? medicamentos.length : 'N/A',
    medicamentos,
  });

  if (
    !paciente_id ||
    !data_proxima_retirada ||
    !data_para_renovacao ||
    !Array.isArray(medicamentos) ||
    medicamentos.length === 0
  ) {
    return res
      .status(400)
      .json({ erro: 'Dados obrigatórios da dispensação ausentes.' });
  }

  const converterData = (d) => {
    const [dia, mes, ano] = d.split('-'); // DD-MM-YYYY
    return `${ano}-${mes}-${dia}`;        // YYYY-MM-DD
  };

  const dataRetiradaSql = converterData(data_proxima_retirada);
  const dataRenovacaoSql = converterData(data_para_renovacao);

  db.getConnection((errConn, conn) => {
    if (errConn) {
      console.error('Erro ao obter conexão para transação:', errConn);
      return res.status(500).json({ erro: 'Erro ao conectar ao banco.' });
    }

    conn.beginTransaction((err) => {
      if (err) {
        conn.release();
        console.error('Erro ao iniciar transação:', err);
        return res.status(500).json({ erro: 'Erro ao iniciar transação.' });
      }

      const sqlDisp =
        'INSERT INTO dispensacoes ' +
        '(paciente_id, data_proxima_retirada, data_para_renovacao, observacoes) ' +
        'VALUES (?, ?, ?, ?)';

      conn.query(
        sqlDisp,
        [paciente_id, dataRetiradaSql, dataRenovacaoSql, observacoes || null],
        (err, resultDisp) => {
          if (err) {
            console.error('Erro ao salvar dispensação (dispensacoes):', err);
            return conn.rollback(() => {
              conn.release();
              res.status(500).json({ erro: 'Erro ao salvar dispensação no banco.' });
            });
          }

          const dispensacao_id = resultDisp.insertId;

          const sqlItem =
            'INSERT INTO dispensacao_itens (dispensacao_id, medicamento_id, nome_medicamento, quantidade, unidade) ' +
            'VALUES (?, ?, ?, ?, ?)';

          const tarefas = medicamentos.map(
            (med) =>
              new Promise((resolve, reject) => {
                const medId =
                  med.medicamento_id && !isNaN(med.medicamento_id)
                    ? med.medicamento_id
                    : null;

                conn.query(
                  sqlItem,
                  [dispensacao_id, medId, med.nome || null, med.quantidade, med.unidade || null],
                  (err2) => {
                    if (err2) return reject(err2);
                    resolve();
                  }
                );
              })
          );

          Promise.all(tarefas)
            .then(() => {
              // Reduzir estoque dos medicamentos com ID cadastrado
              const medsComId = medicamentos.filter(
                m => m.medicamento_id && !isNaN(Number(m.medicamento_id))
              );
              if (medsComId.length === 0) return Promise.resolve();
              return Promise.all(
                medsComId.map(med => new Promise((resolve, reject) => {
                  conn.query(
                    'UPDATE medicamentos SET estoque_atual = GREATEST(0, estoque_atual - ?) WHERE id = ?',
                    [med.quantidade, Number(med.medicamento_id)],
                    (err) => { if (err) return reject(err); resolve(); }
                  );
                }))
              );
            })
            .then(() => {
              conn.commit(async (errCommit) => {
                if (errCommit) {
                  console.error('Erro ao dar commit na transação:', errCommit);
                  return conn.rollback(() => {
                    conn.release();
                    res.status(500).json({ erro: 'Erro ao finalizar a dispensação.' });
                  });
                }

                conn.release();

                const listaMedicamentos = medicamentos
                  .map((m) => {
                    const unidadeTxt = m.unidade ? ` ${m.unidade}` : '';
                    return `- ${m.nome} (${m.quantidade}${unidadeTxt})`;
                  })
                  .join('\n');

                const saudacao = nome_paciente ? `Olá, ${nome_paciente}! 👋` : 'Olá! 👋';

                const texto =
                  `${saudacao}\n\n` +
                  `Sua retirada de medicamentos foi registrada com sucesso.\n\n` +
                  `📋 Medicamentos dispensados:\n${listaMedicamentos}\n\n` +
                  `📅 Próxima retirada: ${data_proxima_retirada}.\n` +
                  `🔄 Renovação da receita: ${data_para_renovacao}.\n\n` +
                  `Esta mensagem não precisa ser respondida.`;

                const sqlMsg =
                  'INSERT INTO mensagens_whatsapp ' +
                  '(paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) ' +
                  'VALUES (?, ?, ?, ?, ?, ?, ?)';

                if (telefone) {
                  try {
                    await enviarMensagemTexto(telefone, texto);
                    db.query(sqlMsg, [paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ENVIADA', null], (err3) => {
                      if (err3) console.error('Erro ao registrar mensagem WhatsApp:', err3);
                    });
                  } catch (erroWpp) {
                    db.query(sqlMsg, [paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ERRO', erroWpp.message], (err4) => {
                      if (err4) console.error('Erro ao registrar erro de WhatsApp:', err4);
                    });
                  }
                }

                res.json({
                  ok: true,
                  dispensacao_id,
                  mensagem: 'Dispensação registrada com sucesso.',
                });
              });
            })
            .catch((errItens) => {
              console.error('Erro ao salvar itens de dispensação:', errItens);
              conn.rollback(() => {
                conn.release();
                res.status(500).json({ erro: 'Erro ao salvar itens da dispensação.' });
              });
            });
        }
      );
    });
  });
});
// ==============================
// CRON - lembretes diários
// ==============================
cron.schedule('0 8 * * *', () => {
  console.log('⏰ Agendador rodando — verificando lembretes...');

  const sqlRetiradas = `
    SELECT d.id, d.paciente_id, d.data_proxima_retirada,
           p.nome, p.telefone
    FROM dispensacoes d
    JOIN pacientes p ON p.id = d.paciente_id
    WHERE d.data_proxima_retirada = DATE_ADD(CURDATE(), INTERVAL 15 DAY)
      AND NOT EXISTS (
        SELECT 1 FROM mensagens_whatsapp m
        WHERE m.dispensacao_id = d.id
          AND m.tipo = 'LEMBRETE_RETIRADA'
          AND m.status_envio = 'ENVIADA'
      )
  `;

  db.query(sqlRetiradas, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar retiradas para lembrete:', err);
      return;
    }

    rows.forEach((row) => {
      const dataFormatada = row.data_proxima_retirada.toLocaleDateString('pt-BR');

      const texto =
        `Olá, ${row.nome}! 👋\n\n` +
        `Lembramos que sua próxima retirada de medicamentos está marcada ` +
        `para o dia ${dataFormatada}.\n\n` +
        `Compareça à farmácia na data indicada.\n\n` +
        `Esta mensagem não precisa ser respondida.`;

      const sqlMsg =
        'INSERT INTO mensagens_whatsapp ' +
        '(paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)';

      enviarMensagemTexto(row.telefone, texto)
        .then(() => {
          db.query(
            sqlMsg,
            [
              row.paciente_id,
              row.id,
              row.telefone,
              texto,
              'LEMBRETE_RETIRADA',
              'ENVIADA',
              null,
            ],
            (err2) => {
              if (err2) {
                console.error('Erro ao registrar lembrete retirada:', err2);
              }
            }
          );
          console.log(`✅ Lembrete de retirada enviado para ${row.nome}`);
        })
        .catch((erro) => {
          db.query(
            sqlMsg,
            [
              row.paciente_id,
              row.id,
              row.telefone,
              texto,
              'LEMBRETE_RETIRADA',
              'ERRO',
              erro.message,
            ],
            (err3) => {
              if (err3) {
                console.error(
                  'Erro ao registrar erro de lembrete retirada:',
                  err3
                );
              }
            }
          );
          console.error(
            `❌ Erro ao enviar lembrete para ${row.nome}:`,
            erro.message
          );
        });
    });
  });

  const sqlRenovacoes = `
    SELECT d.id, d.paciente_id, d.data_para_renovacao,
           p.nome, p.telefone
    FROM dispensacoes d
    JOIN pacientes p ON p.id = d.paciente_id
    WHERE d.data_para_renovacao = DATE_ADD(CURDATE(), INTERVAL 10 DAY)
      AND NOT EXISTS (
        SELECT 1 FROM mensagens_whatsapp m
        WHERE m.dispensacao_id = d.id
          AND m.tipo = 'LEMBRETE_RENOVACAO'
          AND m.status_envio = 'ENVIADA'
      )
  `;

  db.query(sqlRenovacoes, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar renovacoes para lembrete:', err);
      return;
    }

    rows.forEach((row) => {
      const dataFormatada = row.data_para_renovacao.toLocaleDateString('pt-BR');

      const texto =
        `Olá, ${row.nome}! 👋\n\n` +
        `Sua receita médica vence em ${dataFormatada}.\n\n` +
        `Providencie a renovação com seu médico antes dessa data para não ` +
        `interromper o tratamento.\n\n` +
        `Esta mensagem não precisa ser respondida.`;

      const sqlMsg =
        'INSERT INTO mensagens_whatsapp ' +
        '(paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)';

      enviarMensagemTexto(row.telefone, texto)
        .then(() => {
          db.query(
            sqlMsg,
            [
              row.paciente_id,
              row.id,
              row.telefone,
              texto,
              'LEMBRETE_RENOVACAO',
              'ENVIADA',
              null,
            ],
            (err2) => {
              if (err2) {
                console.error('Erro ao registrar lembrete renovação:', err2);
              }
            }
          );
          console.log(`✅ Lembrete de renovação enviado para ${row.nome}`);
        })
        .catch((erro) => {
          db.query(
            sqlMsg,
            [
              row.paciente_id,
              row.id,
              row.telefone,
              texto,
              'LEMBRETE_RENOVACAO',
              'ERRO',
              erro.message,
            ],
            (err3) => {
              if (err3) {
                console.error(
                  'Erro ao registrar erro de lembrete renovação:',
                  err3
                );
              }
            }
          );
          console.error(
            `❌ Erro ao enviar renovação para ${row.nome}:`,
            erro.message
          );
        });
    });
  });
});

// ==============================
// POST /api/usuarios — Cadastro de usuário
// Senha inicial = CPF (somente dígitos), pode ser trocada depois
// ==============================
app.post('/api/usuarios', (req, res) => {
  const { nome, cpf, data_nascimento, email, telefone } = req.body;
  if (!nome || !email || !cpf) {
    return res.status(400).json({ erro: 'Nome, e-mail e CPF são obrigatórios.' });
  }
  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido.' });
  }
  const senhaHash = crypto.createHash('sha256').update(cpfLimpo).digest('hex');
  const sql = 'INSERT INTO usuarios (nome, cpf, data_nascimento, email, telefone, senha) VALUES (?, ?, ?, ?, ?, ?)';
  db.query(
    sql,
    [nome.trim(), cpf.trim(), data_nascimento || null, email.trim().toLowerCase(), telefone || null, senhaHash],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ erro: 'E-mail já cadastrado.' });
        }
        console.error('Erro ao salvar usuário:', err);
        return res.status(500).json({ erro: 'Erro ao salvar usuário.' });
      }
      res.status(201).json({ ok: true, id: result.insertId });
    }
  );
});

// ==============================
// POST /api/login — Autenticação
// Aceita senha digitada como texto (pode ser CPF com ou sem formatação)
// ==============================
app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
  }

  // Tenta o hash da senha como digitada; se falhar, tenta com somente dígitos (CPF formatado)
  const senhaHash = crypto.createHash('sha256').update(senha).digest('hex');
  const senhaDigitosHash = crypto.createHash('sha256').update(senha.replace(/\D/g, '')).digest('hex');

  const sql = 'SELECT id, nome FROM usuarios WHERE email = ? AND (senha = ? OR senha = ?) LIMIT 1';
  db.query(sql, [email.trim().toLowerCase(), senhaHash, senhaDigitosHash], (err, results) => {
    if (err) {
      console.error('Erro ao verificar login:', err);
      return res.status(500).json({ erro: 'Erro ao verificar credenciais.' });
    }
    if (results.length === 0) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    const usuario = results[0];
    const token = crypto.randomBytes(32).toString('hex');
    sessoes.set(token, { userId: usuario.id, nome: usuario.nome, expiraEm: Date.now() + 8 * 3600000 });
    res.json({ ok: true, token, nome: usuario.nome });
  });
});

// ==============================
// GET /api/verificar-token — Valida sessão ativa
// ==============================
app.get('/api/verificar-token', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ autenticado: false });
  const sessao = sessoes.get(token);
  if (!sessao || Date.now() > sessao.expiraEm) {
    if (sessao) sessoes.delete(token);
    return res.status(401).json({ autenticado: false });
  }
  res.json({ autenticado: true, nome: sessao.nome });
});

// ==============================
// DELETE /api/logout — Encerra sessão
// ==============================
app.delete('/api/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sessoes.delete(token);
  res.json({ ok: true });
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// ==============================
// GET /api/dispensacoes/paciente/:id
// Histórico de dispensações de um paciente
// ==============================
app.get('/api/dispensacoes/paciente/:id', (req, res) => {
  const pacienteId = parseInt(req.params.id, 10);
  if (!pacienteId || isNaN(pacienteId)) {
    return res.status(400).json({ erro: 'ID de paciente inválido.' });
  }

  // Busca as últimas dispensações do paciente
  const sqlDisp =
    'SELECT id, data_proxima_retirada, data_para_renovacao, observacoes ' +
    'FROM dispensacoes ' +
    'WHERE paciente_id = ? ' +
    'ORDER BY data_proxima_retirada DESC ' +
    'LIMIT 20';

  db.query(sqlDisp, [pacienteId], (err, dispRows) => {
    if (err) {
      console.error('Erro ao buscar dispensações:', err);
      return res.status(500).json({ erro: 'Erro ao buscar dispensações.' });
    }

    if (dispRows.length === 0) {
      return res.json({ dispensacoes: [] });
    }

    const idsDisp = dispRows.map((d) => d.id);

    // Busca itens de medicamentos dessas dispensações
    const sqlItens =
      'SELECT di.dispensacao_id, di.quantidade, di.unidade, ' +
      'COALESCE(m.nome, di.nome_medicamento, \'\') AS nome ' +
      'FROM dispensacao_itens di ' +
      'LEFT JOIN medicamentos m ON m.id = di.medicamento_id ' +
      'WHERE di.dispensacao_id IN (?)';

    db.query(sqlItens, [idsDisp], (err2, itensRows) => {
      if (err2) {
        console.error('Erro ao buscar itens de dispensação:', err2);
        return res.status(500).json({ erro: 'Erro ao buscar itens de dispensação.' });
      }

      // agrupa itens por dispensacao_id
      const itensPorDisp = {};
      itensRows.forEach((row) => {
        if (!itensPorDisp[row.dispensacao_id]) {
          itensPorDisp[row.dispensacao_id] = [];
        }
        itensPorDisp[row.dispensacao_id].push({
          nome: row.nome || '',
          quantidade: row.quantidade,
          unidade: row.unidade || null,
        });
      });

      const formatarDataBR = (d) => {
        if (!(d instanceof Date)) return d;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        return `${dia}/${mes}/${ano}`;
      };

      const resposta = dispRows.map((d) => ({
        id: d.id,
        data_proxima_retirada: formatarDataBR(d.data_proxima_retirada),
        data_para_renovacao: formatarDataBR(d.data_para_renovacao),
        observacoes: d.observacoes,
        medicamentos: itensPorDisp[d.id] || [],
      }));

      res.json({ dispensacoes: resposta });
    });
  });
});
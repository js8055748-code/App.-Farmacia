require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { enviarMensagemTexto } = require('./whatsapp');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { createPageAuthMiddleware, createApiAuthMiddleware, COOKIE_NAME } = require('./http/middleware/authenticate');
const createPagesRouter = require('./http/routes/pagesRouter');

const SESSION_TTL_MS = 8 * 3600000;
const sessoes = new Map();

let remumeList = [];

async function carregarRemumePDF() {
  const PDF_PATH = path.join(__dirname, '../pdf', 'Relaçao Municipal  de Medicamentos Essenciais- REMUME DIVINÓPOLIS- 2026.pdf');
  if (!fs.existsSync(PDF_PATH)) {
    console.warn('⚠️ PDF REMUME não encontrado em:', PDF_PATH);
    return;
  }
  try {
    const { readPdfText } = require('pdf-text-reader');
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
      if (m.nome.split(' ').length > 5) return false;
      if (!m.apresentacao && m.nome === m.nome.toUpperCase() && m.nome.split(' ').length > 2) return false;
      return true;
    });
    console.log(`✅ REMUME carregada: ${remumeList.length} medicamentos`);
  } catch (err) {
    console.error('❌ Erro ao carregar REMUME:', err.message);
  }
}

carregarRemumePDF();

const app = express();

app.use((req, res, next) => {
  express.json()(req, res, (err) => {
    if (err) {
      console.error('Erro de parse JSON:', err.message);
      return res.status(400).json({ erro: 'JSON inválido na requisição: ' + err.message });
    }
    next();
  });
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const authenticatePage = createPageAuthMiddleware(sessoes);
const authenticateApi = createApiAuthMiddleware(sessoes);
app.use('/', createPagesRouter(authenticatePage));

setInterval(() => {
  const agora = Date.now();
  for (const [token, s] of sessoes) {
    if (agora > s.expiraEm) sessoes.delete(token);
  }
}, 3600000);

app.post('/api/pacientes', authenticateApi, async (req, res) => {
  const { nome, cpf, data_nascimento, telefone, endereco } = req.body;
  if (!nome || !cpf) return res.status(400).json({ erro: 'Nome e CPF são obrigatórios.' });

  const sql = `
    INSERT INTO pacientes (nome, cpf, telefone, data_nascimento, endereco)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `;
  try {
    const result = await db.query(sql, [
      nome.trim(), cpf.trim(),
      telefone ? telefone.trim() : null,
      data_nascimento || null,
      endereco || null,
    ]);
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'CPF já cadastrado.' });
    console.error('Erro ao salvar paciente:', err);
    res.status(500).json({ erro: 'Erro ao salvar paciente.' });
  }
});

app.get('/api/pacientes/cpf/:cpf', authenticateApi, async (req, res) => {
  const cpf = req.params.cpf;
  if (!cpf) return res.status(400).json({ erro: 'CPF é obrigatório.' });

  const cpfLimpo = cpf.replace(/\D/g, '');
  const sql =
    "SELECT id, nome, cpf, telefone FROM pacientes " +
    "WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = $1 LIMIT 1";

  try {
    const result = await db.query(sql, [cpfLimpo]);
    if (result.rows.length === 0) return res.json({ paciente: null });
    const p = result.rows[0];
    res.json({ paciente: { id: p.id, nome: p.nome, cpf: p.cpf, telefone: p.telefone } });
  } catch (err) {
    console.error('Erro ao buscar paciente:', err);
    res.status(500).json({ erro: 'Erro ao buscar paciente.' });
  }
});

app.get('/api/medicamentos', authenticateApi, async (req, res) => {
  const term = (req.query.term || '').trim();

  try {
    if (!term) {
      const sql =
        'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque ' +
        'FROM medicamentos WHERE ativo = 1 ORDER BY nome';
      const result = await db.query(sql);
      return res.json({ medicamentos: result.rows });
    }

    const sql =
      'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque ' +
      'FROM medicamentos WHERE ativo = 1 AND nome ILIKE $1 ORDER BY nome LIMIT 20';
    const result = await db.query(sql, [`%${term}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar medicamentos:', err);
    res.status(500).json({ erro: 'Erro ao listar medicamentos.' });
  }
});

app.post('/api/medicamentos', authenticateApi, async (req, res) => {
  const { nome, principio_ativo, apresentacao, estoque, controlado } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });

  const sql =
    'INSERT INTO medicamentos (nome, principio_ativo, apresentacao, estoque_atual, controlado) ' +
    'VALUES ($1, $2, $3, $4, $5) RETURNING id';

  try {
    const result = await db.query(sql, [
      nome.trim(), principio_ativo || null, apresentacao || null,
      estoque || 0, controlado ? 1 : 0,
    ]);
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Erro ao cadastrar medicamento:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar medicamento.' });
  }
});

app.put('/api/medicamentos/:id', authenticateApi, async (req, res) => {
  const id = req.params.id;
  const { nome, principio_ativo, apresentacao, estoque, controlado } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });

  const sql =
    'UPDATE medicamentos SET nome=$1, principio_ativo=$2, apresentacao=$3, estoque_atual=$4, controlado=$5 WHERE id=$6';

  try {
    const result = await db.query(sql, [
      nome.trim(), principio_ativo || null, apresentacao || null,
      estoque || 0, controlado ? 1 : 0, id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Medicamento não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar medicamento:', err);
    res.status(500).json({ erro: 'Erro ao atualizar medicamento.' });
  }
});

app.get('/api/remume', authenticateApi, (req, res) => {
  const term = (req.query.term || '').toLowerCase().trim();
  if (!term || term.length < 2) return res.json([]);
  res.json(remumeList.filter(m => m.nome.toLowerCase().includes(term)).slice(0, 20));
});

app.post('/api/medicamentos/:id/adicionar-estoque', authenticateApi, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const qtd = parseInt(req.body.quantidade, 10);
  if (!id || isNaN(id)) return res.status(400).json({ erro: 'ID inválido.' });
  if (!qtd || qtd <= 0) return res.status(400).json({ erro: 'Quantidade inválida.' });

  try {
    const result = await db.query(
      'UPDATE medicamentos SET estoque_atual = estoque_atual + $1 WHERE id = $2',
      [qtd, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Medicamento não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao adicionar estoque:', err);
    res.status(500).json({ erro: 'Erro ao atualizar estoque.' });
  }
});

app.post('/api/dispensar', authenticateApi, async (req, res) => {
  const { paciente_id, nome_paciente, telefone, medicamentos, data_proxima_retirada, data_para_renovacao, observacoes } = req.body;

  if (!paciente_id || !data_proxima_retirada || !data_para_renovacao || !Array.isArray(medicamentos) || medicamentos.length === 0) {
    return res.status(400).json({ erro: 'Dados obrigatórios da dispensação ausentes.' });
  }

  const converterData = (d) => { const [dia, mes, ano] = d.split('-'); return `${ano}-${mes}-${dia}`; };
  const dataRetiradaSql = converterData(data_proxima_retirada);
  const dataRenovacaoSql = converterData(data_para_renovacao);

  const client = await db.connect();
  let dispensacao_id;

  try {
    await client.query('BEGIN');

    const resultDisp = await client.query(
      'INSERT INTO dispensacoes (paciente_id, data_proxima_retirada, data_para_renovacao, observacoes) VALUES ($1, $2, $3, $4) RETURNING id',
      [paciente_id, dataRetiradaSql, dataRenovacaoSql, observacoes || null]
    );
    dispensacao_id = resultDisp.rows[0].id;

    for (const med of medicamentos) {
      const medId = med.medicamento_id && !isNaN(med.medicamento_id) ? med.medicamento_id : null;
      await client.query(
        'INSERT INTO dispensacao_itens (dispensacao_id, medicamento_id, nome_medicamento, quantidade, unidade) VALUES ($1, $2, $3, $4, $5)',
        [dispensacao_id, medId, med.nome || null, med.quantidade, med.unidade || null]
      );
    }

    const medsComId = medicamentos.filter(m => m.medicamento_id && !isNaN(Number(m.medicamento_id)));
    for (const med of medsComId) {
      await client.query(
        'UPDATE medicamentos SET estoque_atual = GREATEST(0, estoque_atual - $1) WHERE id = $2',
        [med.quantidade, Number(med.medicamento_id)]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na dispensação:', err);
    client.release();
    return res.status(500).json({ erro: 'Erro ao salvar dispensação no banco.' });
  }

  client.release();

  const listaMedicamentos = medicamentos
    .map(m => `- ${m.nome} (${m.quantidade}${m.unidade ? ` ${m.unidade}` : ''})`)
    .join('\n');
  const saudacao = nome_paciente ? `Olá, ${nome_paciente}! 👋` : 'Olá! 👋';
  const texto =
    `${saudacao}\n\nSua retirada de medicamentos foi registrada com sucesso.\n\n` +
    `📋 Medicamentos dispensados:\n${listaMedicamentos}\n\n` +
    `📅 Próxima retirada: ${data_proxima_retirada}.\n` +
    `🔄 Renovação da receita: ${data_para_renovacao}.\n\nEsta mensagem não precisa ser respondida.`;

  const sqlMsg =
    'INSERT INTO mensagens_whatsapp (paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7)';

  if (telefone) {
    try {
      await enviarMensagemTexto(telefone, texto);
      await db.query(sqlMsg, [paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ENVIADA', null]);
    } catch (erroWpp) {
      await db.query(sqlMsg, [paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ERRO', erroWpp.message]);
    }
  }

  res.json({ ok: true, dispensacao_id, mensagem: 'Dispensação registrada com sucesso.' });
});

if (!process.env.VERCEL) require('node-cron').schedule('0 8 * * *', async () => {
  console.log('⏰ Agendador rodando — verificando lembretes...');

  const sqlMsg =
    'INSERT INTO mensagens_whatsapp (paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7)';

  try {
    const result = await db.query(`
      SELECT d.id, d.paciente_id, d.data_proxima_retirada, p.nome, p.telefone
      FROM dispensacoes d JOIN pacientes p ON p.id = d.paciente_id
      WHERE d.data_proxima_retirada = CURRENT_DATE + INTERVAL '15 days'
        AND NOT EXISTS (
          SELECT 1 FROM mensagens_whatsapp m
          WHERE m.dispensacao_id = d.id AND m.tipo = 'LEMBRETE_RETIRADA' AND m.status_envio = 'ENVIADA'
        )
    `);
    for (const row of result.rows) {
      const dataFormatada = row.data_proxima_retirada.toLocaleDateString('pt-BR');
      const texto =
        `Olá, ${row.nome}! 👋\n\nLembramos que sua próxima retirada de medicamentos está marcada para o dia ${dataFormatada}.\n\n` +
        `Compareça à farmácia na data indicada.\n\nEsta mensagem não precisa ser respondida.`;
      try {
        await enviarMensagemTexto(row.telefone, texto);
        await db.query(sqlMsg, [row.paciente_id, row.id, row.telefone, texto, 'LEMBRETE_RETIRADA', 'ENVIADA', null]);
        console.log(`✅ Lembrete de retirada enviado para ${row.nome}`);
      } catch (erro) {
        await db.query(sqlMsg, [row.paciente_id, row.id, row.telefone, texto, 'LEMBRETE_RETIRADA', 'ERRO', erro.message]);
        console.error(`❌ Erro ao enviar lembrete para ${row.nome}:`, erro.message);
      }
    }
  } catch (err) {
    console.error('Erro ao buscar retiradas para lembrete:', err);
  }

  try {
    const result = await db.query(`
      SELECT d.id, d.paciente_id, d.data_para_renovacao, p.nome, p.telefone
      FROM dispensacoes d JOIN pacientes p ON p.id = d.paciente_id
      WHERE d.data_para_renovacao = CURRENT_DATE + INTERVAL '10 days'
        AND NOT EXISTS (
          SELECT 1 FROM mensagens_whatsapp m
          WHERE m.dispensacao_id = d.id AND m.tipo = 'LEMBRETE_RENOVACAO' AND m.status_envio = 'ENVIADA'
        )
    `);
    for (const row of result.rows) {
      const dataFormatada = row.data_para_renovacao.toLocaleDateString('pt-BR');
      const texto =
        `Olá, ${row.nome}! 👋\n\nSua receita médica vence em ${dataFormatada}.\n\n` +
        `Providencie a renovação com seu médico antes dessa data para não interromper o tratamento.\n\n` +
        `Esta mensagem não precisa ser respondida.`;
      try {
        await enviarMensagemTexto(row.telefone, texto);
        await db.query(sqlMsg, [row.paciente_id, row.id, row.telefone, texto, 'LEMBRETE_RENOVACAO', 'ENVIADA', null]);
        console.log(`✅ Lembrete de renovação enviado para ${row.nome}`);
      } catch (erro) {
        await db.query(sqlMsg, [row.paciente_id, row.id, row.telefone, texto, 'LEMBRETE_RENOVACAO', 'ERRO', erro.message]);
        console.error(`❌ Erro ao enviar renovação para ${row.nome}:`, erro.message);
      }
    }
  } catch (err) {
    console.error('Erro ao buscar renovações para lembrete:', err);
  }
});

app.post('/api/usuarios', async (req, res) => {
  const { nome, cpf, data_nascimento, email, telefone } = req.body;
  if (!nome || !email || !cpf) return res.status(400).json({ erro: 'Nome, e-mail e CPF são obrigatórios.' });

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF inválido.' });

  const senhaHash = crypto.createHash('sha256').update(cpfLimpo).digest('hex');

  try {
    const result = await db.query(
      'INSERT INTO usuarios (nome, cpf, data_nascimento, email, telefone, senha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [nome.trim(), cpf.trim(), data_nascimento || null, email.trim().toLowerCase(), telefone || null, senhaHash]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado.' });
    console.error('Erro ao salvar usuário:', err);
    res.status(500).json({ erro: 'Erro ao salvar usuário.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });

  const senhaHash = crypto.createHash('sha256').update(senha).digest('hex');
  const senhaDigitosHash = crypto.createHash('sha256').update(senha.replace(/\D/g, '')).digest('hex');

  try {
    const result = await db.query(
      'SELECT id, nome FROM usuarios WHERE email = $1 AND (senha = $2 OR senha = $3) LIMIT 1',
      [email.trim().toLowerCase(), senhaHash, senhaDigitosHash]
    );
    if (result.rows.length === 0) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    const usuario = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    sessoes.set(token, { userId: usuario.id, nome: usuario.nome, expiraEm: Date.now() + SESSION_TTL_MS });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true, sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
    });
    res.json({ ok: true, nome: usuario.nome });
  } catch (err) {
    console.error('Erro ao verificar login:', err);
    res.status(500).json({ erro: 'Erro ao verificar credenciais.' });
  }
});

app.get('/api/verificar-token', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ autenticado: false });
  const sessao = sessoes.get(token);
  if (!sessao || Date.now() > sessao.expiraEm) {
    if (sessao) sessoes.delete(token);
    return res.status(401).json({ autenticado: false });
  }
  res.json({ autenticado: true, nome: sessao.nome });
});

app.delete('/api/logout', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) sessoes.delete(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/dispensacoes/paciente/:id', authenticateApi, async (req, res) => {
  const pacienteId = parseInt(req.params.id, 10);
  if (!pacienteId || isNaN(pacienteId)) return res.status(400).json({ erro: 'ID de paciente inválido.' });

  try {
    const dispResult = await db.query(
      'SELECT id, data_proxima_retirada, data_para_renovacao, observacoes FROM dispensacoes WHERE paciente_id = $1 ORDER BY data_proxima_retirada DESC LIMIT 20',
      [pacienteId]
    );
    if (dispResult.rows.length === 0) return res.json({ dispensacoes: [] });

    const idsDisp = dispResult.rows.map(d => d.id);
    const itensResult = await db.query(
      "SELECT di.dispensacao_id, di.quantidade, di.unidade, COALESCE(m.nome, di.nome_medicamento, '') AS nome " +
      'FROM dispensacao_itens di LEFT JOIN medicamentos m ON m.id = di.medicamento_id ' +
      'WHERE di.dispensacao_id = ANY($1)',
      [idsDisp]
    );

    const itensPorDisp = {};
    for (const row of itensResult.rows) {
      if (!itensPorDisp[row.dispensacao_id]) itensPorDisp[row.dispensacao_id] = [];
      itensPorDisp[row.dispensacao_id].push({ nome: row.nome || '', quantidade: row.quantidade, unidade: row.unidade || null });
    }

    const formatarDataBR = (d) => {
      if (!(d instanceof Date)) return d;
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    };

    res.json({
      dispensacoes: dispResult.rows.map(d => ({
        id: d.id,
        data_proxima_retirada: formatarDataBR(d.data_proxima_retirada),
        data_para_renovacao: formatarDataBR(d.data_para_renovacao),
        observacoes: d.observacoes,
        medicamentos: itensPorDisp[d.id] || [],
      })),
    });
  } catch (err) {
    console.error('Erro ao buscar dispensações:', err);
    res.status(500).json({ erro: 'Erro ao buscar dispensações.' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
}

module.exports = app;

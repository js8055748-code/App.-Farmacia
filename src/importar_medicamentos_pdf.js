require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { readPdfText } = require('pdf-text-reader'); 
const mysql = require('mysql2');

const PDF_PATH = path.join(
  __dirname,
  '../pdf',
  'Relaçao Municipal  de Medicamentos Essenciais- REMUME DIVINÓPOLIS- 2026.pdf'
);

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'farmacia',
  port: 3306,
});

db.connect((err) => {
  if (err) {
    console.error('Erro ao conectar no MySQL:', err);
    process.exit(1);
  }
  console.log('Conectado ao MySQL para importação.');

  importarDoPdf();
});

async function importarDoPdf() {
  try {
    if (!fs.existsSync(PDF_PATH)) {
      console.error('PDF não encontrado em:', PDF_PATH);
      process.exit(1);
    }

    console.log('Lendo PDF em:', PDF_PATH);

    // usa readPdfText da lib pdf-text-reader
    const text = await readPdfText({ url: PDF_PATH });

    const linhasBrutas = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    console.log(`Encontradas ${linhasBrutas.length} linhas no PDF.`);

    const sqlInsert = `
      INSERT INTO medicamentos (nome, apresentacao, ativo)
      VALUES (?, ?, 1)
    `;

    let inseridos = 0;

    for (const linha of linhasBrutas) {
      const partes = linha.split(' ').filter(p => p.length > 0);
      let idxPrimeiroNumero = partes.findIndex(p => /\d/.test(p));

      let nome;
      let apresentacao;

      if (idxPrimeiroNumero === -1) {
        nome = linha;
        apresentacao = '';
      } else {
        nome = partes.slice(0, idxPrimeiroNumero).join(' ');
        apresentacao = partes.slice(idxPrimeiroNumero).join(' ');
      }

      await inserirMedicamento(sqlInsert, nome, apresentacao);
      inseridos++;
    }

    console.log(`Importação concluída. Medicamentos inseridos: ${inseridos}`);
    db.end();
  } catch (err) {
    console.error('Erro na importação do PDF:', err);
    db.end();
    process.exit(1);
  }
}

function inserirMedicamento(sql, nome, apresentacao) {
  return new Promise((resolve, reject) => {
    db.query(sql, [nome, apresentacao], (err) => {
      if (err) {
        console.error('Erro ao inserir medicamento:', nome, '-', apresentacao, err.code);
        return reject(err);
      }
      resolve();
    });
  });
}
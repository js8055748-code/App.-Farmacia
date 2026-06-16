require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // necessário para o Neon
  },
});

// Testa a conexão ao iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Erro ao conectar ao banco de dados:", err.message);
  } else {
    console.log("✅ Conectado ao banco de dados Neon com sucesso!");
    release();
  }
});

module.exports = pool;
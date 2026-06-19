require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect()
  .then(client => {
    console.log('Conectado ao PostgreSQL com sucesso.');
    client.release();
  })
  .catch(err => console.error('Erro ao conectar no PostgreSQL:', err.message));

module.exports = pool;

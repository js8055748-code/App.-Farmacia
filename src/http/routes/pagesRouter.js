const express = require('express');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '../../../views');

function createPagesRouter(authenticate) {
  const router = express.Router();

  router.get('/', authenticate, (req, res) => res.sendFile('index.html', { root: VIEWS_DIR }));
  router.get('/estoque', authenticate, (req, res) => res.sendFile('estoque.html', { root: VIEWS_DIR }));
  router.get('/dispensar', authenticate, (req, res) => res.sendFile('lancar_medicacao.html', { root: VIEWS_DIR }));
  router.get('/cadastro-paciente', authenticate, (req, res) => res.sendFile('cadastro_pct.html', { root: VIEWS_DIR }));
  router.get('/cadastro-usuario', (req, res) => res.sendFile('cadastro_usuario.html', { root: VIEWS_DIR }));
  router.get('/atendimento', authenticate, (req, res) => res.sendFile('pacientes.html', { root: VIEWS_DIR }));

  return router;
}

module.exports = createPagesRouter;

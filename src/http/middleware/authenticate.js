const COOKIE_NAME = 'session';

function createPageAuthMiddleware(sessoes) {
  return function authenticate(req, res, next) {
    const token = req.cookies[COOKIE_NAME];
    const session = token ? sessoes.get(token) : null;
    if (!session || Date.now() > session.expiraEm) {
      if (session) sessoes.delete(token);
      return res.redirect('/login.html');
    }
    req.user = { id: session.userId, nome: session.nome };
    next();
  };
}

function createApiAuthMiddleware(sessoes) {
  return function authenticateApi(req, res, next) {
    const token = req.cookies[COOKIE_NAME];
    const session = token ? sessoes.get(token) : null;
    if (!session || Date.now() > session.expiraEm) {
      if (session) sessoes.delete(token);
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    req.user = { id: session.userId, nome: session.nome };
    next();
  };
}

module.exports = { createPageAuthMiddleware, createApiAuthMiddleware, COOKIE_NAME };
